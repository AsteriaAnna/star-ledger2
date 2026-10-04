import type {LedgerSnapshot} from '../accounting/index.ts';
import type {BusinessCommand} from '../domain/accounting.ts';
import {applyCommands,interpret} from '../accounting/business.ts';
import {relationDecision,refundRelationContext} from './refund-relations.ts';
import type {ImportWorkspaceSnapshot} from '../importing/workspace.ts';
import {summarizeSession} from '../importing/attention.ts';
const expectedErrors=new Set(['ORIGINAL_UNAVAILABLE','INVALID_RETURN_KIND','RETURN_BEFORE_ORIGINAL','RETURN_EXCEEDS_ORIGINAL','CONSUMPTION_ALLOCATION_REQUIRED','SPONSORED_REFUND_HAS_OWN_ACCOUNT']);
function evidence(snapshot:LedgerSnapshot){
 return snapshot.entities.filter(e=>e.type==='source_records').flatMap(row=>{try{
  const data=JSON.parse(String(row.fields.raw_payload));if(!data||typeof data!=='object')return [];
  return [{transactionId:String(row.fields.transaction_id),platform:String(row.fields.platform),profile:typeof data.profile==='string'?data.profile:'本人',order:typeof data.order==='string'?data.order:null,originalOrder:typeof data.originalOrder==='string'?data.originalOrder:null}];
 }catch{return [];}});
}
/** Only a unique, namespaced original order is automatic; weak similarities never become a link. */
export function planLateRefundRelations(snapshot:LedgerSnapshot):BusinessCommand[]{
 if(snapshot.conflicts.length)throw Error('UNRESOLVED_CONFLICT');
 const sources=evidence(snapshot),groups=new Map<string,string[]>();
 const originals=snapshot.entities.filter(e=>e.type==='transactions'&&!e.fields.deleted_at&&!e.fields.purged_at&&e.fields.status==='SUCCESS');
 for(const refund of originals.filter(e=>['REFUND','RETURN'].includes(String(e.fields.event_type)))){
  if(refund.fields.user_edits){try{const edited=JSON.parse(String(refund.fields.user_edits));if(edited.version!==1||!Array.isArray(edited.fields))throw Error();if(edited.fields.includes('category'))continue;}catch{throw Error('INVALID_USER_EDIT_HISTORY');}}
  if(relationDecision(snapshot,refund.id)!==undefined||snapshot.entities.some(e=>e.type==='transaction_links'&&e.fields.from_transaction_id===refund.id))continue;
  const claims=sources.filter(e=>e.transactionId===refund.id).flatMap(e=>{const order=e.originalOrder??(e.platform==='支付宝'?e.order?.match(/^(.+?)(?:\*REFUND_\d+|_\d+)$/)?.[1]:null);return order?[{...e,originalOrder:order}]:[];});
  if(!claims.length)continue;
  const targets=new Set<string>();let ambiguous=false;
  for(const claim of claims){
   const ids=new Set(sources.filter(e=>e.platform===claim.platform&&e.profile===claim.profile&&e.order===claim.originalOrder).map(e=>e.transactionId));
   const matches=originals.filter(e=>ids.has(e.id)&&(refund.fields.event_type==='REFUND'?e.fields.event_type==='PURCHASE':['EXTERNAL_TRANSFER','DEPOSIT','RED_PACKET'].includes(String(e.fields.event_type))));
   if(matches.length!==1){ambiguous=true;break;}targets.add(matches[0].id);
  }
  if(ambiguous||targets.size!==1)continue;
  const originalId=[...targets][0];if(!groups.has(originalId))groups.set(originalId,[]);groups.get(originalId)!.push(refund.id);
 }
 let working=snapshot;const commands:BusinessCommand[]=[];
 for(const [originalId,ids] of groups){let trial=working;const planned:BusinessCommand[]=[];let valid=true;
  for(const id of ids.sort()){
   const command:BusinessCommand={kind:'LINK_RETURN',transactionId:id,originalId};
   try{trial=applyCommands(trial,interpret(command,trial));planned.push(command);}catch(error){if(!(error instanceof Error&&expectedErrors.has(error.message)))throw error;valid=false;break;}
  }
  if(valid){working=trial;commands.push(...planned);}
 }
 return commands;
}
/** Reconcile existing local questions from durable facts; never change a committed outcome to blocked. */
export function refreshRefundAttention(workspace:ImportWorkspaceSnapshot,ledger:LedgerSnapshot,now:string):ImportWorkspaceSnapshot{
 const next=structuredClone(workspace);
 for(const [sessionId,items] of Object.entries(next.attention)){
  let changed=false;
  next.attention[sessionId]=items.flatMap(item=>{
   if(!['REFUND_RELATION','CONSUMPTION_ALLOCATION'].includes(item.kind))return [item];
   const outcome=next.outcomes[sessionId]?.find(e=>e.externalRecordId===item.externalRecordId);
   if(outcome?.state!=='COMMITTED'||!outcome.transactionId)return [item];
   const tx=ledger.entities.find(e=>e.type==='transactions'&&e.id===outcome.transactionId&&!e.fields.deleted_at&&!e.fields.purged_at);
   if(!tx||tx.fields.status!=='SUCCESS'||!['REFUND','RETURN'].includes(String(tx.fields.event_type)))return [item];
   if(relationDecision(ledger,tx.id)?.originalId===null||ledger.entities.some(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.from_transaction_id===tx.id)){changed=true;return [];}
   const context=refundRelationContext(ledger,tx.id),candidateIds=new Set(item.candidates.map(e=>e.id));
   const candidates=context.candidates.map(e=>({id:e.id,label:String(e.fields.display_name),detail:String(e.fields.occurred_at)}));
   if(candidates.length!==candidateIds.size||candidates.some(e=>!candidateIds.has(e.id)))changed=true;
   return [{...item,candidates}];
  });
  if(changed&&next.sessions[sessionId])next.sessions[sessionId]=summarizeSession(next.sessions[sessionId],next.attention[sessionId],now);
 }
 return next;
}
