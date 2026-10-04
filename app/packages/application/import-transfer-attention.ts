import type {Command,LedgerSnapshot} from '../accounting/index.ts';
import {applyCommands,correctionSnapshot,interpret,pendingPostings} from '../accounting/business.ts';
import type {BusinessCommand,CreateAccount} from '../domain/accounting.ts';
import type {ImportWorkspaceSnapshot} from '../importing/workspace.ts';
import {completeImportSessionFromOutcomes} from './import-execution.ts';
import {resolveAccount} from '../importing/account-resolution.ts';
import {rememberAccountMappingCommand} from '../importing/resolution-memory.ts';
import {planImportAccountReevaluation} from './import-account-reevaluation.ts';

export function transferAttentionContext(sessionId:string,attentionId:string,workspace:ImportWorkspaceSnapshot,ledger:LedgerSnapshot){
 const session=workspace.sessions[sessionId],item=workspace.attention[sessionId]?.find(a=>a.id===attentionId);
 if(!session||!item||item.kind!=='TRANSFER_ENDPOINTS'||item.blocking)throw Error('STALE_IMPORT_ATTENTION');
 const result=workspace.outcomes[sessionId]?.find(o=>o.externalRecordId===item.externalRecordId);
 const transaction=ledger.entities.find(e=>e.type==='transactions'&&e.id===result?.transactionId&&!e.fields.deleted_at&&!e.fields.purged_at);
 if(result?.state!=='COMMITTED'||!transaction||!['SUCCESS','PENDING'].includes(String(transaction.fields.status)))throw Error('TRANSACTION_UNAVAILABLE');
 if(!['REPAYMENT','INTERNAL_TRANSFER','WITHDRAWAL'].includes(String(transaction.fields.event_type)))throw Error('TRANSFER_ENDPOINT_NOT_SUPPORTED');
 const postings=transaction.fields.status==='PENDING'?pendingPostings(transaction):ledger.entities;
 const movements=postings.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id===transaction.id&&e.fields.amount!==0);
 const flow=(movement:typeof movements[number])=>Number(movement.fields.amount)*(ledger.entities.find(a=>a.type==='accounts'&&a.id===movement.fields.account_id)?.fields.type==='LIABILITY'?-1:1);
 const outgoing=movements.filter(m=>flow(m)<0),incoming=movements.filter(m=>flow(m)>0);
 if(outgoing.length!==1||incoming.length!==1)throw Error('TRANSFER_ENDPOINT_NOT_SUPPORTED');
 const from=outgoing[0],to=incoming[0],accountType=transaction.fields.event_type==='REPAYMENT'?'LIABILITY' as const:'ASSET' as const;
 const accounts=ledger.entities.filter(e=>e.type==='accounts'&&!e.fields.deleted_at&&e.fields.type===accountType&&e.id!==from.fields.account_id);
 return {session,item,transaction,from,to,accountType,accounts,expectedSnapshot:correctionSnapshot(ledger.entities,transaction.id)};
}

export type ImportTransferAnswer={sessionId:string;attentionId:string;accountId:string;expectedSnapshot:string;now:string;createAccount?:CreateAccount};
export function planImportTransferAnswer(input:ImportTransferAnswer,workspace:ImportWorkspaceSnapshot,ledger:LedgerSnapshot){
 const context=transferAttentionContext(input.sessionId,input.attentionId,workspace,ledger);
 if(context.expectedSnapshot!==input.expectedSnapshot)throw Error('STALE_TRANSACTION');
 const commands:Command[]=[];let working=ledger;
 const advance=(command:BusinessCommand)=>{const next=interpret(command,working);commands.push(...next);working=applyCommands(working,next);};
 if(input.createAccount){
  if(input.createAccount.id!==input.accountId||input.createAccount.accountType!==context.accountType)throw Error('ACCOUNT_UNAVAILABLE');
  advance(input.createAccount);
 }
 const account=working.entities.find(e=>e.type==='accounts'&&e.id===input.accountId&&!e.fields.deleted_at);
 if(!account||account.fields.type!==context.accountType)throw Error('ACCOUNT_UNAVAILABLE');
 if(input.accountId===context.from.fields.account_id)throw Error('SAME_ACCOUNT_TRANSFER');
 if(context.transaction.fields.status==='PENDING')advance({kind:'BIND_PENDING_ACCOUNT',transactionId:context.transaction.id,movementId:context.to.id,accountId:input.accountId,expectedSnapshot:context.expectedSnapshot});
 else advance({kind:'BIND_ACCOUNT',movementId:context.to.id,accountId:input.accountId});
 const source=workspace.records[input.sessionId]?.find(r=>r.id===context.item.externalRecordId);
 if(source?.facts.targetChannelRaw){
  const request={eventKind:String(context.transaction.fields.event_type),sourceSystem:source.sourceSystem,platform:source.platformRaw,profile:source.profile,channelRaw:source.facts.targetChannelRaw,role:'TARGET' as const,sponsored:false};
  const resolution=resolveAccount({...request,rememberedAccountId:input.accountId},working.entities,working.conflicts);
  if(resolution.state!=='RESOLVED'||resolution.accountId!==input.accountId)throw Error('ACCOUNT_UNAVAILABLE');
  if(resolution.memoryKey){const memory=rememberAccountMappingCommand(working.entities,resolution.memoryKey,{accountId:input.accountId,rememberedAt:input.now});commands.push(memory);working=applyCommands(working,[memory]);}
 }
 const next=structuredClone(workspace);
 for(const [sessionId,items] of Object.entries(next.attention)){
  const recordIds=new Set((next.outcomes[sessionId]??[]).filter(o=>o.transactionId===context.transaction.id&&o.state==='COMMITTED').map(o=>o.externalRecordId));
  next.attention[sessionId]=items.filter(a=>a.kind!=='TRANSFER_ENDPOINTS'||!recordIds.has(a.externalRecordId));
  if(items.length!==next.attention[sessionId].length)next.sessions[sessionId]=completeImportSessionFromOutcomes(next.sessions[sessionId],next.outcomes[sessionId]??[],next.attention[sessionId],input.now);
 }
 const reevaluated=planImportAccountReevaluation(next,working,input.now);
 return {commands:[...commands,...reevaluated.commands],workspace:reevaluated.workspace};
}
