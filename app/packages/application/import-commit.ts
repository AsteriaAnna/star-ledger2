import type {LedgerIntent} from '../domain/accounting.ts';
import type {ExternalRecord} from '../importing/types.ts';
import {buildImportedLedgerIntent,importedSourceEvidence} from './import-ledger-intent.ts';
import type {ResolveImportResult} from './import-service.ts';

export type ImportRevival={transactionId:string;externalRecordId:string};
export type ImportCommitPlan={
 newRecords:{externalRecordId:string;intent:LedgerIntent}[];
 evidenceUpdates:{externalRecordId:string;transactionId:string;source:ReturnType<typeof importedSourceEvidence>}[];
 revivals:ImportRevival[];
 skippedDuplicateIds:string[];
 noEffectRecordIds:string[];
 blockedRecordIds:string[];
 attentionRecordIds:string[];
};

function sourceMap(records:ExternalRecord[]){return new Map(records.map(record=>[record.id,record]));}
export function planImportCommit(result:ResolveImportResult,records:ExternalRecord[]):ImportCommitPlan{
 const sources=sourceMap(records);
 const plan:ImportCommitPlan={newRecords:[],evidenceUpdates:[],revivals:[],skippedDuplicateIds:[],noEffectRecordIds:[],blockedRecordIds:[],attentionRecordIds:[]};
 for(const record of result.records){
  const source=sources.get(record.externalRecordId);if(!source)throw Error('MISSING_EXTERNAL_RECORD');
  if(record.attention.length)plan.attentionRecordIds.push(record.externalRecordId);
  if(record.disposition==='SKIP_DUPLICATE'){plan.skippedDuplicateIds.push(record.externalRecordId);continue;}
  if(record.disposition==='SOURCE_UPDATE'){
   if(record.transactionId)plan.evidenceUpdates.push({externalRecordId:record.externalRecordId,transactionId:record.transactionId,source:importedSourceEvidence(source,result.captureEvidence)});
   plan.blockedRecordIds.push(record.externalRecordId);continue;
  }
  if(record.disposition==='NO_EFFECT'){plan.noEffectRecordIds.push(record.externalRecordId);continue;}
  if(record.disposition==='NEEDS_ATTENTION'||record.ledgerState==='NEEDS_ATTENTION'){plan.blockedRecordIds.push(record.externalRecordId);continue;}
  if(record.disposition==='REVIVE_EXISTING'){
   if(!record.transactionId)throw Error('MISSING_REVIVE_TRANSACTION');
   plan.revivals.push({transactionId:record.transactionId,externalRecordId:record.externalRecordId});
   continue;
  }
  if(record.disposition==='INTERPRETED'&&record.ledgerState==='READY_FOR_LEDGER'){
   plan.newRecords.push({externalRecordId:record.externalRecordId,intent:buildImportedLedgerIntent({resolved:record,source,captureEvidence:result.captureEvidence})});continue;
  }
  // NOT_APPLICABLE is valid only for already-classified duplicate/no-effect records.
  if(record.ledgerState!=='NOT_APPLICABLE')throw Error('UNPLANNED_IMPORT_STATE');
 }
 return plan;
}
