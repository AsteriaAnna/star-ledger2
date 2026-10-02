import type {LedgerSnapshot} from '../accounting/index.ts';
import {findSourceMatch} from '../importing/dedup.ts';
import {attentionId,assertAttentionItem,summarizeSession} from '../importing/attention.ts';
import type {AttentionItem,EventInterpretation,ExternalRecord,ImportSession,ImportSourceType,SourceSystem} from '../importing/types.ts';
import type {ImportWorkspaceRepository} from './ports.ts';

export type ImportDisposition='READY'|'NO_EFFECT'|'SKIP_DUPLICATE'|'REVIVE_EXISTING'|'NEEDS_ATTENTION';

export type PreparedImportRecord={
 externalRecordId:string;
 disposition:ImportDisposition;
 transactionId:string|null;
 interpretation:EventInterpretation;
 attention:AttentionItem[];
};

export type PrepareImportResult={
 session:ImportSession;
 records:PreparedImportRecord[];
};

export type PrepareImportInput={
 sessionId:string;
 sourceType:ImportSourceType;
 sourceSystem:SourceSystem;
 records:ExternalRecord[];
 interpretations:EventInterpretation[];
 ledger:LedgerSnapshot;
 now:string;
};

const attention=(sessionId:string,recordId:string,kind:AttentionItem['kind'],question:string,now:string,candidates:AttentionItem['candidates']=[],blocking=true):AttentionItem=>{
 const item={id:attentionId(sessionId,recordId,kind),sessionId,externalRecordId:recordId,kind,question,blocking,candidates,createdAt:now};
 assertAttentionItem(item);return item;
};

function validateInterpretation(sessionId:string,record:ExternalRecord,value:EventInterpretation,now:string):AttentionItem[]{
 if(value.status==='FAILED')return [];
 const out:AttentionItem[]=[];
 if(value.amountFen===null||!Number.isSafeInteger(value.amountFen)||value.amountFen<=0)out.push(attention(sessionId,record.id,'AMOUNT','无法确定这笔记录的有效金额',now));
 if(!value.occurredAt||!Number.isFinite(Date.parse(value.occurredAt)))out.push(attention(sessionId,record.id,'DATE','无法确定这笔记录的发生时间',now));
 if(value.status==='UNKNOWN')out.push(attention(sessionId,record.id,'STATUS','无法确定这笔记录是否已经成功',now));
 if(value.eventKind==='UNKNOWN')out.push(attention(sessionId,record.id,'EVENT_MEANING','无法确定这笔记录属于哪种账务事件',now));
 return out;
}

export class ImportStatementService {
 constructor(private workspace:ImportWorkspaceRepository){}

 async prepare(input:PrepareImportInput):Promise<PrepareImportResult>{
  const byRecord=new Map(input.interpretations.map(value=>[value.externalRecordId,value]));
  if(byRecord.size!==input.interpretations.length)throw Error('DUPLICATE_INTERPRETATION');
  for(const record of input.records)if(record.sessionId!==input.sessionId)throw Error('IMPORT_SESSION_MISMATCH');

  const existing=await this.workspace.getSession(input.sessionId);
  const base:ImportSession=existing??{
   id:input.sessionId,sourceType:input.sourceType,sourceSystem:input.sourceSystem,
   createdAt:input.now,updatedAt:input.now,state:'PROCESSING',sourceCount:input.records.length,
   committedCount:0,skippedDuplicateCount:0,blockingAttentionCount:0,nonBlockingAttentionCount:0,failureCode:null
  };
  if(base.sourceType!==input.sourceType||base.sourceSystem!==input.sourceSystem)throw Error('IMPORT_SESSION_SOURCE_MISMATCH');

  await this.workspace.putExternalRecords(input.records);
  const prepared:PreparedImportRecord[]=[];
  const allAttention:AttentionItem[]=[];
  let skippedDuplicateCount=0;

  for(const record of input.records){
   const interpretation=byRecord.get(record.id);
   if(!interpretation)throw Error('MISSING_INTERPRETATION');
   if(interpretation.externalRecordId!==record.id)throw Error('INTERPRETATION_RECORD_MISMATCH');

   const sourceMatch=findSourceMatch({
    value:record.sourceIdentity,
    platform:record.platformRaw,
    profile:record.profile,
    orderId:record.facts.orderId
   },input.ledger.entities);

   if(sourceMatch.activeTransactionIds.length===1){
    skippedDuplicateCount++;
    prepared.push({externalRecordId:record.id,disposition:'SKIP_DUPLICATE',transactionId:sourceMatch.activeTransactionIds[0],interpretation,attention:[]});
    continue;
   }
   if(sourceMatch.activeTransactionIds.length>1){
    const items=[attention(input.sessionId,record.id,'POSSIBLE_DUPLICATE','同一来源对应多笔现有账单，需要确认保留哪一笔',input.now,sourceMatch.activeTransactionIds.map(id=>({id,label:id})))];
    allAttention.push(...items);prepared.push({externalRecordId:record.id,disposition:'NEEDS_ATTENTION',transactionId:null,interpretation,attention:items});continue;
   }
   if(sourceMatch.deletedTransactionIds.length===1){
    prepared.push({externalRecordId:record.id,disposition:'REVIVE_EXISTING',transactionId:sourceMatch.deletedTransactionIds[0],interpretation,attention:[]});continue;
   }
   if(sourceMatch.deletedTransactionIds.length>1){
    const items=[attention(input.sessionId,record.id,'POSSIBLE_DUPLICATE','同一来源对应多笔回收站记录，需要确认恢复哪一笔',input.now,sourceMatch.deletedTransactionIds.map(id=>({id,label:id})))];
    allAttention.push(...items);prepared.push({externalRecordId:record.id,disposition:'NEEDS_ATTENTION',transactionId:null,interpretation,attention:items});continue;
   }

   if(interpretation.status==='FAILED'){
    prepared.push({externalRecordId:record.id,disposition:'NO_EFFECT',transactionId:null,interpretation,attention:[]});continue;
   }

   const items=validateInterpretation(input.sessionId,record,interpretation,input.now);
   allAttention.push(...items);
   prepared.push({externalRecordId:record.id,disposition:items.length?'NEEDS_ATTENTION':'READY',transactionId:null,interpretation,attention:items});
  }

  const session=summarizeSession({...base,sourceCount:input.records.length,skippedDuplicateCount,updatedAt:input.now},allAttention,input.now);
  await this.workspace.replaceAttentionItems(input.sessionId,allAttention);
  await this.workspace.putSession(session);
  return {session,records:prepared};
 }
}
