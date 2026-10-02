import type {BusinessCommand} from '../domain/accounting.ts';
import type {LedgerSnapshot} from '../accounting/index.ts';
import {applyCommands,correctionSnapshot,interpret} from '../accounting/business.ts';
import {planTransactionCorrection} from './correction-service.ts';
import type {ImportCommitPlan} from './import-commit.ts';
import type {AttentionItem,ImportRecordOutcome,ImportSession} from '../importing/types.ts';
import {summarizeSession} from '../importing/attention.ts';

export type ImportExecutionPlan={
 commands:BusinessCommand[];
 createdIds:string[];
 createdRecordIds:string[];
 revivedIds:string[];
 revivedRecordIds:string[];
 skippedDuplicateIds:string[];
 noEffectRecordIds:string[];
 blockedRecordIds:string[];
};

function advance(snapshot:LedgerSnapshot,command:BusinessCommand){
 const commands=interpret(command,snapshot);
 return {snapshot:commands.length?applyCommands(snapshot,commands):snapshot,commands};
}

/**
 * Builds one accounting command batch from an already-resolved import plan.
 * The returned commands are intended for BusinessAccountingService.executeBatch,
 * so a store transaction commits all ledger effects or none of them.
 */
export function planImportExecution(plan:ImportCommitPlan,snapshot:LedgerSnapshot,now:string):ImportExecutionPlan{
 let working=snapshot;const commands:BusinessCommand[]=[];
 const created:string[]=[],createdRecords:string[]=[],revived:string[]=[],revivedRecords:string[]=[];

 for(const entry of plan.newRecords){
  const intent=entry.intent,next=advance(working,intent);working=next.snapshot;commands.push(intent);created.push(intent.id);createdRecords.push(entry.externalRecordId);
 }

 for(const update of plan.evidenceUpdates){
  const command:BusinessCommand={kind:'ATTACH_SOURCE_EVIDENCE',transactionId:update.transactionId,source:update.source};
  const next=advance(working,command);working=next.snapshot;commands.push(command);
 }

 for(const revival of plan.revivals){
  const restore:BusinessCommand={kind:'RESTORE_TRANSACTION',transactionId:revival.transactionId};
  const restored=advance(working,restore);working=restored.snapshot;commands.push(restore);
  const correction=planTransactionCorrection({
   transactionId:revival.transactionId,replacement:revival.replacement,
   expectedSnapshot:correctionSnapshot(working.entities,revival.transactionId),correctedAt:now
  },working);
  for(const command of correction.commands){const next=advance(working,command);working=next.snapshot;commands.push(command);}
  revived.push(revival.transactionId);revivedRecords.push(revival.externalRecordId);
 }

 return {
  commands,createdIds:created,createdRecordIds:createdRecords,revivedIds:revived,revivedRecordIds:revivedRecords,
  skippedDuplicateIds:[...plan.skippedDuplicateIds],
  noEffectRecordIds:[...plan.noEffectRecordIds],
  blockedRecordIds:[...plan.blockedRecordIds]
 };
}


export function mergeImportOutcomes(existing:ImportRecordOutcome[],next:ImportRecordOutcome[]):ImportRecordOutcome[]{
 const map=new Map(existing.map(item=>[item.externalRecordId,item]));
 for(const item of next)map.set(item.externalRecordId,item);
 return [...map.values()].sort((a,b)=>a.externalRecordId.localeCompare(b.externalRecordId));
}
export function completeImportSessionFromOutcomes(session:ImportSession,outcomes:ImportRecordOutcome[],attention:AttentionItem[],now:string):ImportSession{
 const committed=outcomes.filter(item=>item.state==='COMMITTED').length;
 const skipped=outcomes.filter(item=>item.state==='SKIPPED_DUPLICATE').length;
 const noEffect=outcomes.filter(item=>item.state==='NO_EFFECT').length;
 return summarizeSession({...session,committedCount:committed,skippedDuplicateCount:skipped,noEffectCount:noEffect},attention,now);
}
export function completeImportSession(session:ImportSession,execution:ImportExecutionPlan,attention:AttentionItem[],now:string):ImportSession{
 return completeImportSessionFromOutcomes(session,importRecordOutcomes(session.id,execution,now),attention,now);
}


export function importRecordOutcomes(sessionId:string,execution:ImportExecutionPlan,now:string):ImportRecordOutcome[]{
 const out:ImportRecordOutcome[]=[];
 execution.createdRecordIds.forEach((externalRecordId,index)=>out.push({sessionId,externalRecordId,state:'COMMITTED',transactionId:execution.createdIds[index]??null,updatedAt:now}));
 execution.revivedRecordIds.forEach((externalRecordId,index)=>out.push({sessionId,externalRecordId,state:'COMMITTED',transactionId:execution.revivedIds[index]??null,updatedAt:now}));
 execution.skippedDuplicateIds.forEach(externalRecordId=>out.push({sessionId,externalRecordId,state:'SKIPPED_DUPLICATE',transactionId:null,updatedAt:now}));
 execution.noEffectRecordIds.forEach(externalRecordId=>out.push({sessionId,externalRecordId,state:'NO_EFFECT',transactionId:null,updatedAt:now}));
 execution.blockedRecordIds.forEach(externalRecordId=>out.push({sessionId,externalRecordId,state:'BLOCKED',transactionId:null,updatedAt:now}));
 return out.sort((a,b)=>a.externalRecordId.localeCompare(b.externalRecordId));
}
