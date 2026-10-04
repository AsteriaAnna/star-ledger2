import type {LedgerSnapshot,Command} from '../accounting/index.ts';
import {applyCommands,correctionSnapshot,interpret,pendingPostings} from '../accounting/business.ts';
import type {BusinessCommand,CreateAccount} from '../domain/accounting.ts';
import type {ExternalRecord} from '../importing/types.ts';
import type {ImportWorkspaceSnapshot} from '../importing/workspace.ts';
import {resolveAccount,type AccountResolutionRequest} from '../importing/account-resolution.ts';
import {accountMappingKey,rememberAccountMappingCommand} from '../importing/resolution-memory.ts';
import {describeFundingChannel} from '../importing/channel.ts';
import {completeImportSessionFromOutcomes} from './import-execution.ts';

export type ImportAccountAnswer={sessionId:string;attentionId:string;accountId:string;createAccount?:CreateAccount;now:string;remember?:boolean};

/** Plan against the current ledger and workspace inside the caller's transaction. */
export function planImportAccountAnswer(input:ImportAccountAnswer,workspace:ImportWorkspaceSnapshot,ledger:LedgerSnapshot){
 const session=workspace.sessions[input.sessionId];
 const items=workspace.attention[input.sessionId]??[];
 const selected=items.find(item=>item.id===input.attentionId);
 if(!session||!selected)throw Error('STALE_IMPORT_ATTENTION');
 if(selected.kind!=='ACCOUNT'||selected.blocking)throw Error('ATTENTION_NOT_ACCOUNT_BINDING');
 const sources=workspace.records[input.sessionId]??[],outcomes=workspace.outcomes[input.sessionId]??[];
 const commands:Command[]=[];let working=ledger;
 const advance=(command:BusinessCommand)=>{const next=interpret(command,working);commands.push(...next);working=applyCommands(working,next);};
 if(input.createAccount){
  if(input.createAccount.id!==input.accountId)throw Error('ACCOUNT_UNAVAILABLE');
  advance(input.createAccount);
 }
 const requestFor=(source:ExternalRecord,transactionId:string):AccountResolutionRequest=>{
  const tx=working.entities.find(e=>e.type==='transactions'&&e.id===transactionId&&!e.fields.deleted_at&&!e.fields.purged_at);
  if(!tx||!['SUCCESS','PENDING'].includes(String(tx.fields.status)))throw Error('TRANSACTION_UNAVAILABLE');
  return {eventKind:String(tx.fields.event_type),sourceSystem:source.sourceSystem,platform:source.platformRaw,profile:source.profile,channelRaw:source.facts.channelRaw,role:'ACCOUNT',sponsored:/亲情卡|亲属卡/.test(source.facts.channelRaw)};
 };
 const source=sources.find(r=>r.id===selected.externalRecordId);
 const outcome=outcomes.find(o=>o.externalRecordId===selected.externalRecordId);
 if(!source||outcome?.state!=='COMMITTED'||!outcome.transactionId)throw Error('IMPORT_RECORD_NOT_COMMITTED');
 const request=requestFor(source,outcome.transactionId);
 const resolution=resolveAccount(request,working.entities,working.conflicts);
 if(!resolution.memoryKey)throw Error('ACCOUNT_MEMORY_NOT_APPLICABLE');
 const target=working.entities.find(e=>e.type==='accounts'&&e.id===input.accountId);
 const descriptor=describeFundingChannel(source.platformRaw,source.facts.channelRaw);
 if(descriptor&&target?.fields.type!==descriptor.type)throw Error('ACCOUNT_UNAVAILABLE');
 const confirmed=resolveAccount({...request,rememberedAccountId:input.accountId},working.entities,working.conflicts);
 if(confirmed.state!=='RESOLVED'||confirmed.accountId!==input.accountId)throw Error('ACCOUNT_UNAVAILABLE');
 const key=accountMappingKey(resolution.memoryKey),resolvedIds=new Set<string>();
 for(const item of items){
  if(item.kind!=='ACCOUNT'||item.blocking)continue;
  const record=sources.find(r=>r.id===item.externalRecordId),result=outcomes.find(o=>o.externalRecordId===item.externalRecordId);
  if(!record||result?.state!=='COMMITTED'||!result.transactionId)continue;
  // Only the selected channel in this session is included in the user's decision.
  const transaction=working.entities.find(e=>e.type==='transactions'&&e.id===result.transactionId);
  if(!transaction||transaction.fields.deleted_at||!['SUCCESS','PENDING'].includes(String(transaction.fields.status)))continue;
  const candidate=resolveAccount({...requestFor(record,result.transactionId),rememberedAccountId:input.accountId},working.entities,working.conflicts);
  if(!candidate.memoryKey||accountMappingKey(candidate.memoryKey)!==key)continue;
  if(candidate.state!=='RESOLVED'||candidate.accountId!==input.accountId)throw Error('ACCOUNT_UNAVAILABLE');
  const kind=String(transaction.fields.event_type);
  // Transfers have two legs. PRIMARY always denotes the outgoing leg.
  const outgoing=['REPAYMENT','INTERNAL_TRANSFER','WITHDRAWAL'].includes(kind);
  const pending=transaction.fields.status==='PENDING';
  const postings=pending?pendingPostings(transaction):working.entities;
  const movements=postings.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id===result.transactionId&&Number(e.fields.amount)!==0&&(!outgoing||Number(e.fields.amount)<0));
  if(movements.length!==1)throw Error('STALE_IMPORT_ATTENTION');
  if(pending)advance({kind:'BIND_PENDING_ACCOUNT',transactionId:transaction.id,movementId:movements[0].id,accountId:input.accountId,expectedSnapshot:correctionSnapshot(working.entities,transaction.id)});
  else advance({kind:'BIND_ACCOUNT',movementId:movements[0].id,accountId:input.accountId});
  resolvedIds.add(item.id);
 }
 if(!resolvedIds.has(selected.id))throw Error('STALE_IMPORT_ATTENTION');
 if(input.remember!==false)commands.push(rememberAccountMappingCommand(working.entities,resolution.memoryKey,{accountId:input.accountId,rememberedAt:input.now}));
 const next=structuredClone(workspace);
 next.attention[input.sessionId]=items.filter(item=>!resolvedIds.has(item.id));
 next.sessions[input.sessionId]=completeImportSessionFromOutcomes(session,outcomes,next.attention[input.sessionId],input.now);
 return {commands,workspace:next,resolvedCount:resolvedIds.size};
}
