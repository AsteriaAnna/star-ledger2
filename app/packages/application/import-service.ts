import type {LedgerSnapshot} from '../accounting/index.ts';
import {findSourceMatch} from '../importing/dedup.ts';
import {createAttention,summarizeSession} from '../importing/attention.ts';
import type {AttentionItem,EventInterpretation,ExternalRecord,ImportSession,ImportSourceType,SourceSystem} from '../importing/types.ts';
import type {ImportWorkspaceRepository,ResolutionMemoryRepository} from './ports.ts';
import {resolveAccount,type AccountResolution,type AccountResolutionRequest} from '../importing/account-resolution.ts';
import {resolveRefundRelation,type RefundRelationResolution} from '../importing/relation-resolution.ts';
import {emptyChannel} from '../importing/channel.ts';

export type ImportDisposition='INTERPRETED'|'NO_EFFECT'|'SKIP_DUPLICATE'|'REVIVE_EXISTING'|'NEEDS_ATTENTION';

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

export type ResolvedImportRecord=PreparedImportRecord&{
 ledgerState:'READY_FOR_LEDGER'|'NOT_APPLICABLE'|'NEEDS_ATTENTION';
 account:AccountResolution|null;
 relation:RefundRelationResolution|null;
};

export type ResolveImportResult={
 session:ImportSession;
 records:ResolvedImportRecord[];
};

export type ResolveImportInput={
 prepared:PrepareImportResult;
 records:ExternalRecord[];
 ledger:LedgerSnapshot;
 now:string;
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

function validateInterpretation(sessionId:string,record:ExternalRecord,value:EventInterpretation,now:string):AttentionItem[]{
 if(value.status==='FAILED')return [];
 const out:AttentionItem[]=[];
 if(value.amountFen===null||!Number.isSafeInteger(value.amountFen)||value.amountFen<=0)out.push(createAttention({sessionId,externalRecordId:record.id,kind:'AMOUNT',question:'无法确定这笔记录的有效金额',blocking:true,candidates:[],createdAt:now}));
 if(!value.occurredAt||!Number.isFinite(Date.parse(value.occurredAt)))out.push(createAttention({sessionId,externalRecordId:record.id,kind:'DATE',question:'无法确定这笔记录的发生时间',blocking:true,candidates:[],createdAt:now}));
 if(value.status==='UNKNOWN')out.push(createAttention({sessionId,externalRecordId:record.id,kind:'STATUS',question:'无法确定这笔记录是否已经成功',blocking:true,candidates:[],createdAt:now}));
 if(value.eventKind==='UNKNOWN')out.push(createAttention({sessionId,externalRecordId:record.id,kind:'EVENT_MEANING',question:'无法确定这笔记录属于哪种账务事件',blocking:true,candidates:[],createdAt:now}));
 return out;
}

export class ImportStatementService {
 private workspace:ImportWorkspaceRepository;
 private memories:ResolutionMemoryRepository|undefined;
 constructor(workspace:ImportWorkspaceRepository,memories?:ResolutionMemoryRepository){this.workspace=workspace;this.memories=memories;}

 async resolveFundingAccount(request:AccountResolutionRequest,ledger:LedgerSnapshot){
  const deterministic=resolveAccount({...request,rememberedAccountId:null},ledger.entities,ledger.conflicts);
  if(deterministic.state==='RESOLVED'||deterministic.state==='NOT_APPLICABLE'||!deterministic.memoryKey||!this.memories)return deterministic;
  const remembered=await this.memories.findAccountMapping(deterministic.memoryKey);
  if(!remembered)return deterministic;
  return resolveAccount({...request,rememberedAccountId:remembered.accountId},ledger.entities,ledger.conflicts);
 }

 async rememberFundingAccount(request:AccountResolutionRequest,accountId:string,ledger:LedgerSnapshot,now:string){
  if(!this.memories)throw Error('RESOLUTION_MEMORY_UNAVAILABLE');
  const resolution=resolveAccount({...request,rememberedAccountId:null},ledger.entities,ledger.conflicts);
  if(!resolution.memoryKey)throw Error('ACCOUNT_MEMORY_NOT_APPLICABLE');
  if(resolution.state==='RESOLVED'&&resolution.accountId!==accountId)throw Error('ACCOUNT_MAPPING_CONTRADICTS_DETERMINISTIC_FACT');
  const selected=resolveAccount({...request,rememberedAccountId:accountId},ledger.entities,ledger.conflicts);
  if(selected.state!=='RESOLVED'||selected.accountId!==accountId)throw Error('ACCOUNT_UNAVAILABLE');
  await this.memories.rememberAccountMapping(resolution.memoryKey,{accountId,rememberedAt:now});
 }

 async resolve(input:ResolveImportInput):Promise<ResolveImportResult>{
  const byRecord=new Map(input.records.map(record=>[record.id,record]));
  const allAttention:AttentionItem[]=[];
  const resolved:ResolvedImportRecord[]=[];

  for(const prepared of input.prepared.records){
   const source=byRecord.get(prepared.externalRecordId);
   if(!source)throw Error('MISSING_EXTERNAL_RECORD');
   const baseAttention=[...prepared.attention];
   if(prepared.disposition!=='INTERPRETED'){
    allAttention.push(...baseAttention);
    resolved.push({...prepared,ledgerState:prepared.disposition==='NEEDS_ATTENTION'?'NEEDS_ATTENTION':'NOT_APPLICABLE',account:null,relation:null});
    continue;
   }

   const interpretation=prepared.interpretation;
   const sponsored=/亲情卡|亲属卡/.test(source.facts.channelRaw);
   let relation:RefundRelationResolution|null=null;
   if((interpretation.eventKind==='REFUND'||interpretation.eventKind==='RETURN')&&interpretation.amountFen!==null&&interpretation.occurredAt){
    relation=resolveRefundRelation({
     kind:interpretation.eventKind,amountFen:interpretation.amountFen,occurredAt:interpretation.occurredAt,
     platform:source.platformRaw,profile:source.profile,displayName:interpretation.displayName,
     originalOrderId:source.facts.originalOrderId,orderId:source.facts.orderId,statusRaw:source.facts.statusRaw,productRaw:source.facts.productRaw
    },input.ledger.entities);
   }

   let account:AccountResolution|null=null;
   const accountKinds=new Set(['PURCHASE','INCOME','TRANSFER_IN','INTERNAL_TRANSFER','WITHDRAWAL','EXTERNAL_TRANSFER','DEPOSIT','RED_PACKET','REFUND','RETURN','REPAYMENT']);
   if(accountKinds.has(interpretation.eventKind)){
    account=await this.resolveFundingAccount({
     eventKind:interpretation.eventKind,sourceSystem:source.sourceSystem,platform:source.platformRaw,profile:source.profile,
     channelRaw:source.facts.channelRaw,role:'ACCOUNT',sponsored
    },input.ledger);
   }

   const items=[...baseAttention];
   const accountCandidates=(account?.candidates??[]).map(id=>{
    const entity=input.ledger.entities.find(e=>e.type==='accounts'&&e.id===id);
    return {id,label:String(entity?.fields.name||id)};
   });
   if(account?.state==='SPLIT')items.push(createAttention({sessionId:input.prepared.session.id,externalRecordId:source.id,kind:'SPLIT_PAYMENT',question:'这笔记录使用了多个资金账户，需要确认资金如何分摊',blocking:true,candidates:accountCandidates,createdAt:input.now}));
   else if(account&&['SUGGESTED','UNRESOLVED','INVALID_MEMORY','CONFLICT'].includes(account.state)&&!emptyChannel(source.facts.channelRaw)){
    items.push(createAttention({sessionId:input.prepared.session.id,externalRecordId:source.id,kind:'ACCOUNT',question:account.reason,blocking:false,candidates:accountCandidates,createdAt:input.now}));
   }

   if(interpretation.eventKind==='REPAYMENT'){
    items.push(createAttention({sessionId:input.prepared.session.id,externalRecordId:source.id,kind:'TRANSFER_ENDPOINTS',question:'还款需要确认转出资产账户和还款的负债账户',blocking:true,candidates:accountCandidates,createdAt:input.now}));
   }else if(['INTERNAL_TRANSFER','WITHDRAWAL'].includes(interpretation.eventKind)){
    items.push(createAttention({sessionId:input.prepared.session.id,externalRecordId:source.id,kind:'TRANSFER_ENDPOINTS',question:'已记录资金变化，另一端账户仍待补充',blocking:false,candidates:[],createdAt:input.now}));
   }

   if(relation?.state==='SUGGESTED'){
    const candidates=relation.candidates.map(id=>{
     const entity=input.ledger.entities.find(e=>e.type==='transactions'&&e.id===id);
     return {id,label:String(entity?.fields.display_name||id),detail:entity?String(entity.fields.occurred_at):undefined};
    });
    items.push(createAttention({sessionId:input.prepared.session.id,externalRecordId:source.id,kind:'REFUND_RELATION',question:relation.reason,blocking:false,candidates,createdAt:input.now}));
   }
   // No candidate is not a user failure: an unlinked refund/return can be posted and related later.

   if(relation?.state==='RESOLVED'&&relation.sponsored!==null&&relation.sponsored!==sponsored&&!/^[\s/\-]*$/.test(source.facts.channelRaw)){
    items.push(createAttention({sessionId:input.prepared.session.id,externalRecordId:source.id,kind:'ACCOUNT',question:'退款到账方式与原交易的资金来源不一致，需要核对',blocking:true,candidates:accountCandidates,createdAt:input.now}));
   }

   allAttention.push(...items);
   resolved.push({...prepared,ledgerState:items.some(item=>item.blocking)?'NEEDS_ATTENTION':'READY_FOR_LEDGER',account,relation,attention:items});
  }

  const session=summarizeSession({...input.prepared.session,updatedAt:input.now},allAttention,input.now);
  await this.workspace.replaceAttentionItems(session.id,allAttention);
  await this.workspace.putSession(session);
  return {session,records:resolved};
 }
 async prepare(input:PrepareImportInput):Promise<PrepareImportResult>{
  const byRecord=new Map(input.interpretations.map(value=>[value.externalRecordId,value]));
  if(byRecord.size!==input.interpretations.length)throw Error('DUPLICATE_INTERPRETATION');
  for(const record of input.records)if(record.sessionId!==input.sessionId)throw Error('IMPORT_SESSION_MISMATCH');

  const existing=await this.workspace.getSession(input.sessionId);
  const base:ImportSession=existing??{
   id:input.sessionId,sourceType:input.sourceType,sourceSystem:input.sourceSystem,
   createdAt:input.now,updatedAt:input.now,state:'PROCESSING',sourceCount:input.records.length,
   committedCount:0,skippedDuplicateCount:0,noEffectCount:0,blockingAttentionCount:0,nonBlockingAttentionCount:0,failureCode:null
  };
  if(base.sourceType!==input.sourceType||base.sourceSystem!==input.sourceSystem)throw Error('IMPORT_SESSION_SOURCE_MISMATCH');

  await this.workspace.putExternalRecords(input.records);
  const prepared:PreparedImportRecord[]=[];
  const allAttention:AttentionItem[]=[];
  let skippedDuplicateCount=0,noEffectCount=0;

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
    const items=[createAttention({sessionId:input.sessionId,externalRecordId:record.id,kind:'POSSIBLE_DUPLICATE',question:'同一来源对应多笔现有账单，需要确认保留哪一笔',blocking:true,candidates:sourceMatch.activeTransactionIds.map(id=>({id,label:id})),createdAt:input.now})];
    allAttention.push(...items);prepared.push({externalRecordId:record.id,disposition:'NEEDS_ATTENTION',transactionId:null,interpretation,attention:items});continue;
   }
   if(sourceMatch.deletedTransactionIds.length===1){
    prepared.push({externalRecordId:record.id,disposition:'REVIVE_EXISTING',transactionId:sourceMatch.deletedTransactionIds[0],interpretation,attention:[]});continue;
   }
   if(sourceMatch.deletedTransactionIds.length>1){
    const items=[createAttention({sessionId:input.sessionId,externalRecordId:record.id,kind:'POSSIBLE_DUPLICATE',question:'同一来源对应多笔回收站记录，需要确认恢复哪一笔',blocking:true,candidates:sourceMatch.deletedTransactionIds.map(id=>({id,label:id})),createdAt:input.now})];
    allAttention.push(...items);prepared.push({externalRecordId:record.id,disposition:'NEEDS_ATTENTION',transactionId:null,interpretation,attention:items});continue;
   }

   if(interpretation.status==='FAILED'){
    noEffectCount++;
    prepared.push({externalRecordId:record.id,disposition:'NO_EFFECT',transactionId:null,interpretation,attention:[]});continue;
   }

   const items=validateInterpretation(input.sessionId,record,interpretation,input.now);
   allAttention.push(...items);
   prepared.push({externalRecordId:record.id,disposition:items.length?'NEEDS_ATTENTION':'INTERPRETED',transactionId:null,interpretation,attention:items});
  }

  const session=summarizeSession({...base,sourceCount:input.records.length,skippedDuplicateCount,noEffectCount,updatedAt:input.now},allAttention,input.now);
  await this.workspace.replaceAttentionItems(input.sessionId,allAttention);
  await this.workspace.putSession(session);
  return {session,records:prepared};
 }
}
