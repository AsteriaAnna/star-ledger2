import type {BusinessCommand} from '../domain/accounting.ts';
import type {LedgerSnapshot} from '../accounting/index.ts';
import {applyCommands,correctionSnapshot,interpret} from '../accounting/business.ts';
import {planTransactionCorrection} from './correction-service.ts';
import type {ImportCommitPlan} from './import-commit.ts';

export type ImportExecutionPlan={
 commands:BusinessCommand[];
 createdIds:string[];
 revivedIds:string[];
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
 const created:string[]=[],revived:string[]=[];

 for(const intent of plan.newIntents){
  const next=advance(working,intent);working=next.snapshot;commands.push(intent);created.push(intent.id);
 }

 for(const revival of plan.revivals){
  const restore:BusinessCommand={kind:'RESTORE_TRANSACTION',transactionId:revival.transactionId};
  const restored=advance(working,restore);working=restored.snapshot;commands.push(restore);
  const correction=planTransactionCorrection({
   transactionId:revival.transactionId,replacement:revival.replacement,
   expectedSnapshot:correctionSnapshot(working.entities,revival.transactionId),correctedAt:now
  },working);
  for(const command of correction.commands){const next=advance(working,command);working=next.snapshot;commands.push(command);}
  revived.push(revival.transactionId);
 }

 return {
  commands,createdIds:created,revivedIds:revived,
  skippedDuplicateIds:[...plan.skippedDuplicateIds],
  noEffectRecordIds:[...plan.noEffectRecordIds],
  blockedRecordIds:[...plan.blockedRecordIds]
 };
}
