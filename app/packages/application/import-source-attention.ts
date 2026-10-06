import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import type {Command,LedgerSnapshot} from '../accounting/index.ts';
import {applyCommands,correctionSnapshot,interpret,pendingPostings} from '../accounting/business.ts';
import type {BusinessCommand} from '../domain/accounting.ts';
import type {ExternalRecord} from '../importing/types.ts';
import {InMemoryImportWorkspace,type ImportWorkspaceSnapshot} from '../importing/workspace.ts';
import {findSourceMatch} from '../importing/dedup.ts';
import {readAccountMapping} from '../importing/resolution-memory.ts';
import {ImportStatementService} from './import-service.ts';
import {buildImportedLedgerIntent,importedSourceEvidence,importedSourceRecordId,sourceIdentityNamespace,sourceDecisionId} from './import-ledger-intent.ts';
import {planTransactionCorrection} from './correction-service.ts';
import {completeImportSessionFromOutcomes} from './import-execution.ts';

export type SourceAnswerMode='KEEP_EXISTING'|'APPLY_SOURCE';
export type SourceAnswerRequest={sessionId:string;attentionId:string;mode:SourceAnswerMode;expectedToken:string;now:string;restoreDeleted?:boolean};
export function sourceReviewToken(workspace:ImportWorkspaceSnapshot,ledger:LedgerSnapshot){
 return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify({workspace,ledger:{entities:ledger.entities,conflicts:ledger.conflicts}}))));
}
export function sourceReviewContext(sessionId:string,attentionId:string,workspace:ImportWorkspaceSnapshot,ledger:LedgerSnapshot){
 const session=workspace.sessions[sessionId],item=workspace.attention[sessionId]?.find(a=>a.id===attentionId);
 const source=workspace.records[sessionId]?.find(r=>r.id===item?.externalRecordId);
 if(!session||!item||item.kind!=='SOURCE_UPDATE'||!source)throw Error('STALE_IMPORT_ATTENTION');
 const match=findSourceMatch({value:source.sourceIdentity,platform:source.platformRaw,profile:source.profile,orderId:source.facts.orderId,rawPayload:source.rawPayload,captureEventClass:source.capture?.sourceClass},ledger.entities);
 if(match.transactionIds.length>1)throw Error('AMBIGUOUS_SOURCE_TARGET');
 const target=ledger.entities.find(e=>e.type==='transactions'&&e.id===match.transactionIds[0]);
 const interpretation=workspace.interpretations?.[sessionId]?.find(i=>i.externalRecordId===source.id);
 return {session,item,source,target,interpretation,token:sourceReviewToken(workspace,ledger)};
}

/** Pure planning over captured state. Caller must compare the token inside its atomic write. */
export async function planImportSourceAnswer(input:SourceAnswerRequest,workspace:ImportWorkspaceSnapshot,ledger:LedgerSnapshot){
 if(!['KEEP_EXISTING','APPLY_SOURCE'].includes(input.mode))throw Error('INVALID_SOURCE_DECISION');
 if(sourceReviewToken(workspace,ledger)!==input.expectedToken)throw Error('STALE_SOURCE_REVIEW');
 const {source,target,interpretation,session}=sourceReviewContext(input.sessionId,input.attentionId,workspace,ledger);
 if(input.mode==='KEEP_EXISTING'&&!target)throw Error('SOURCE_TARGET_REQUIRED');
 const commands:Command[]=[];let working=ledger;
 const advance=(command:BusinessCommand)=>{const next=interpret(command,working);commands.push(...next);working=applyCommands(working,next);};
 if(target?.fields.deleted_at){
  if(input.restoreDeleted!==true)throw Error('EXPLICIT_RESTORE_REQUIRED');
  advance({kind:'RESTORE_TRANSACTION',transactionId:target.id});
 }
 let transactionId=target?.id;let followups=workspace.attention[input.sessionId].filter(a=>a.externalRecordId===source.id&&a.kind!=='SOURCE_UPDATE');
 if(input.mode==='APPLY_SOURCE'){
  if(!interpretation)throw Error('IMPORT_INTERPRETATION_UNAVAILABLE');
  if(interpretation.status!=='SUCCESS')throw Error('SOURCE_STATUS_REQUIRES_REVIEW');
  // Evaluate the replacement without the old postings consuming refund quota.
  const clean={...working,entities:working.entities.filter(e=>!(e.type==='transactions'&&e.id===target?.id)&&!(target&&(e.fields.transaction_id===target.id||e.fields.from_transaction_id===target.id)))};
  const service=new ImportStatementService(new InMemoryImportWorkspace(workspace),{
   findAccountMapping:async key=>readAccountMapping(clean.entities,key),rememberAccountMapping:async()=>{},findMerchantCategory:async()=>null,rememberMerchantCategory:async()=>{}
  });
  const prepared={session,records:[{externalRecordId:source.id,disposition:'INTERPRETED' as const,transactionId:null,interpretation,attention:[]}]};
  const resolved=await service.resolve({prepared,records:[source],ledger:clean,now:input.now}),row=resolved.records[0];
  if(row.ledgerState!=='READY_FOR_LEDGER'||row.attention.some(a=>a.blocking))throw Error('SOURCE_FACTS_REQUIRE_ANSWER');
  let replacement=buildImportedLedgerIntent({resolved:row,source,captureEvidence:workspace.captureEvidence?.[source.sessionId]});
  if(target){
   const oldPostings=target.fields.status==='PENDING'&&target.fields.posting_plan?pendingPostings(target):working.entities;
   const oldMovements=oldPostings.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id===target.id&&e.fields.amount!==0);
   if(oldMovements.some(e=>e.fields.account_id!==null)&&row.attention.some(a=>a.kind==='ACCOUNT'))throw Error('SOURCE_ACCOUNT_UNRESOLVED');
   replacement={...replacement,id:target.id,name:String(target.fields.display_name),note:String(target.fields.note)};
   if(replacement.kind==='PURCHASE'){
    const effect=oldPostings.find(e=>e.type==='consumption_effects'&&e.fields.transaction_id===target.id);
    if(effect)replacement={...replacement,categoryId:typeof effect.fields.category_id==='string'?effect.fields.category_id:undefined};
   }
   const correction=planTransactionCorrection({transactionId:target.id,replacement,expectedSnapshot:correctionSnapshot(working.entities,target.id),correctedAt:input.now},working);
   if(correction.relationReviewIds.length)throw Error('SOURCE_CHANGE_REQUIRES_RELATION_REVIEW');
   for(const command of correction.commands)advance(command);
   if(replacement.kind==='REFUND'||replacement.kind==='RETURN'){
    const link=working.entities.find(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.from_transaction_id===target.id);
    // A changed source must not silently replace an existing relationship with a guess.
    if(link&&link.fields.to_transaction_id!==replacement.originalId)throw Error('SOURCE_CHANGE_REQUIRES_RELATION_REVIEW');
    if(!link&&replacement.originalId)advance({kind:'LINK_RETURN',transactionId:target.id,originalId:replacement.originalId});
   }
  }else advance(replacement);
  transactionId=replacement.id;followups=row.attention;
 }
 if(!transactionId)throw Error('SOURCE_TARGET_REQUIRED');
 const next=structuredClone(workspace),accepted=new Set<string>();
 // In a fresh conflicting group, choosing one snapshot explicitly settles its alternatives.
 const selectedGroup=workspace.records[input.sessionId].filter(r=>sourceIdentityNamespace(r)===sourceIdentityNamespace(source)&&workspace.attention[input.sessionId].some(a=>a.externalRecordId===r.id&&a.kind==='SOURCE_UPDATE'));
 const sources=target?[source]:selectedGroup;
 for(const evidence of sources){
  if(accepted.has(importedSourceRecordId(evidence)))continue;
  const decisionId=sourceDecisionId(evidence);
  if(working.conflicts.some(c=>c.entity_type==='import_rules'&&c.entity_id===decisionId))throw Error('UNRESOLVED_CONFLICT');
  if(working.entities.some(e=>e.type==='import_rules'&&e.id===decisionId))throw Error('SOURCE_ALREADY_DECIDED');
  advance({kind:'ATTACH_SOURCE_EVIDENCE',transactionId,source:importedSourceEvidence(evidence,workspace.captureEvidence?.[evidence.sessionId])});
  commands.push({action:'CREATE_ENTITY',entity:{type:'import_rules',id:decisionId,fields:{rule_key:decisionId,value:JSON.stringify({version:1,kind:'SOURCE_DECISION',sourceId:importedSourceRecordId(evidence),transactionId,choice:evidence.id===source.id?input.mode:'REJECT_ALTERNATIVE',decidedAt:input.now})}}});
  accepted.add(importedSourceRecordId(evidence));
 }
 // A decision about an exact evidence version also resolves copies in older sessions.
 for(const [sessionId,records] of Object.entries(next.records)){
  const affected=records.filter(r=>accepted.has(importedSourceRecordId(r))&&next.attention[sessionId]?.some(a=>a.externalRecordId===r.id&&a.kind==='SOURCE_UPDATE'));
  if(!affected.length)continue;
  const primary=affected.find(r=>sessionId===input.sessionId&&r.id===source.id)??affected.find(r=>importedSourceRecordId(r)===importedSourceRecordId(source));
  const ids=new Set(affected.map(r=>r.id));next.attention[sessionId]=next.attention[sessionId].filter(a=>!ids.has(a.externalRecordId));
  for(const record of affected){
   if(record.id===primary?.id)next.attention[sessionId].push(...followups.map(a=>({...a,id:`attention:${sessionId}:${record.id}:${a.kind}`,sessionId,externalRecordId:record.id})));
  }
  const outcomes=new Map((next.outcomes[sessionId]??[]).map(o=>[o.externalRecordId,o]));
  for(const r of affected)outcomes.set(r.id,{sessionId,externalRecordId:r.id,state:r.id===primary?.id?'COMMITTED':'SKIPPED_DUPLICATE',transactionId,updatedAt:input.now});
  next.outcomes[sessionId]=[...outcomes.values()];
  next.sessions[sessionId]=completeImportSessionFromOutcomes(next.sessions[sessionId],next.outcomes[sessionId],next.attention[sessionId],input.now);
 }
 return {commands,workspace:next,transactionId,preview:working.entities.find(e=>e.type==='transactions'&&e.id===transactionId)!,movements:working.entities.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id===transactionId&&e.fields.amount!==0)};
}
