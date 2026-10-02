import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import type {LedgerIntent,SourceEvidence} from '../domain/accounting.ts';
import type {ExternalRecord} from '../importing/types.ts';
import type {ResolvedImportRecord} from './import-service.ts';

export type LedgerIntentBuildInput={
 resolved:ResolvedImportRecord;
 source:ExternalRecord;
};

export const sourceIdentityNamespace=(source:ExternalRecord)=>[source.sourceSystem,source.platformRaw,source.profile,source.sourceIdentity].map(value=>encodeURIComponent(value)).join(':');
export const importedTransactionId=(source:ExternalRecord)=>'import-v2:'+sourceIdentityNamespace(source);
export const importedSourceRecordId=(source:ExternalRecord)=>'source-v2:'+bytesToHex(sha256(new TextEncoder().encode(sourceIdentityNamespace(source)+'\n'+source.rawPayload)));

export function importSourcePayload(source:ExternalRecord){
 return JSON.stringify({
  version:3,
  identity:source.sourceIdentity,
  profile:source.profile,
  order:source.facts.orderId,
  originalOrder:source.facts.originalOrderId,
  refundId:source.facts.refundId,
  sourceSystem:source.sourceSystem,
  channel:source.facts.channelRaw,
  original:source.rawPayload,
  parserVersion:source.parserVersion,
  precision:source.facts.precision
 });
}

export function importedSourceEvidence(source:ExternalRecord):SourceEvidence{return {id:importedSourceRecordId(source),sourceType:source.sourceType,platform:source.platformRaw,rawPayload:importSourcePayload(source),capturedAt:source.capturedAt};}

export function buildImportedLedgerIntent(input:LedgerIntentBuildInput):LedgerIntent{
 const {resolved,source}=input,interpretation=resolved.interpretation;
 if(resolved.ledgerState!=='READY_FOR_LEDGER'||resolved.disposition!=='INTERPRETED')throw Error('IMPORT_NOT_READY_FOR_LEDGER');
 if(interpretation.amountFen===null||!Number.isSafeInteger(interpretation.amountFen)||interpretation.amountFen<=0)throw Error('INVALID_MONEY');
 if(!interpretation.occurredAt||!Number.isFinite(Date.parse(interpretation.occurredAt)))throw Error('INVALID_TIMESTAMP');
 if(interpretation.status==='UNKNOWN'||interpretation.status==='FAILED')throw Error('IMPORT_STATUS_NOT_POSTABLE');
 if(interpretation.eventKind==='UNKNOWN')throw Error('IMPORT_EVENT_NOT_POSTABLE');

 const id=importedTransactionId(source);
 const sourceEvidence=importedSourceEvidence(source);
 const base={id,occurredAt:interpretation.occurredAt,name:interpretation.displayName.trim()||source.facts.counterpartyRaw||source.facts.productRaw||source.facts.transactionTypeRaw||'账单记录',amount:interpretation.amountFen,status:interpretation.status,note:source.facts.noteRaw||source.facts.productRaw||'',source:sourceEvidence};
 const account=resolved.account?.state==='RESOLVED'?resolved.account.accountId:null;
 const sourceSponsored=/亲情卡|亲属卡/.test(source.facts.channelRaw);
 const relationSponsored=resolved.relation?.state==='RESOLVED'?resolved.relation.sponsored:null;
 const sponsored=relationSponsored??sourceSponsored;
 const relationAccount=resolved.relation?.state==='RESOLVED'?resolved.relation.destinationAccountId:null;
 const primary=account??relationAccount??null;
 const originalId=resolved.relation?.state==='RESOLVED'?resolved.relation.originalId:null;

 switch(interpretation.eventKind){
  case 'PURCHASE':return {...base,kind:'PURCHASE',payer:sponsored?null:primary,categoryId:interpretation.categorySuggestion??undefined,funding:sponsored?'EXTERNAL_SPONSOR':'OWN'};
  case 'INCOME':case 'TRANSFER_IN':return {...base,kind:interpretation.eventKind,destination:primary};
  case 'INTERNAL_TRANSFER':return {...base,kind:'INTERNAL_TRANSFER',from:primary,to:null};
  case 'WITHDRAWAL':{
   const fee=source.facts.feeFen;
   if(fee===null||fee===undefined||!Number.isSafeInteger(fee)||fee<0)throw Error('WITHDRAWAL_FEE_UNRESOLVED');
   return {...base,kind:'WITHDRAWAL',from:primary,to:null,fee};
  }
  case 'EXTERNAL_TRANSFER':case 'DEPOSIT':case 'RED_PACKET':
   // Transfer form alone never implies consumption. Consumption meaning is an independent, later-editable decision.
   return {...base,kind:interpretation.eventKind,from:primary,consumptionAmount:0};
  case 'REFUND':case 'RETURN':
   return {...base,kind:interpretation.eventKind,originalId,destination:sponsored?null:primary,funding:sponsored?'EXTERNAL_SPONSOR':'OWN'};
  case 'REPAYMENT':return {...base,kind:'REPAYMENT',from:primary,to:null};
  default:throw Error('IMPORT_EVENT_NOT_POSTABLE');
 }
}
