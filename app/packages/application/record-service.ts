import type {AccountRef,BalanceAllocation,LedgerIntent} from '../domain/accounting.ts';

type Base={transactionId:string;amount:number;occurredAt?:string;name?:string;note?:string};
export type SpendRecord=Base&{action:'SPEND';payer:AccountRef;payerAllocations?:BalanceAllocation[];categoryId?:string;funding?:'OWN'|'EXTERNAL_SPONSOR'};
export type ReceiveRecord=Base&(
 {action:'RECEIVE';meaning?:'INCOME';destination:AccountRef}|
 {action:'RECEIVE';meaning:'REFUND';destination:AccountRef;destinationAllocations?:BalanceAllocation[];originalId?:string|null;funding?:'OWN'|'EXTERNAL_SPONSOR';categoryId?:string}
);
export type TransferRecord=Base&(
 {action:'TRANSFER';meaning:'BETWEEN_OWN';from:AccountRef;to:AccountRef}|
 {action:'TRANSFER';meaning:'TO_OTHER';from:AccountRef;consumptionAmount?:number;categoryId?:string}|
 {action:'TRANSFER';meaning:'REPAYMENT';from:string;to:string}|
 {action:'TRANSFER';meaning:'WITHDRAWAL';from:AccountRef;to:AccountRef;fee?:number}
);
export type ManualRecordRequest=SpendRecord|ReceiveRecord|TransferRecord;

const base=(request:ManualRecordRequest,now:string)=>({
 id:request.transactionId,amount:request.amount,occurredAt:request.occurredAt??now,
 name:request.name?.trim()||(
  request.action==='SPEND'?'消费':
  request.action==='RECEIVE'?(request.meaning==='REFUND'?'退款':'收入'):
  request.meaning==='REPAYMENT'?'还款':request.meaning==='WITHDRAWAL'?'提现':'转账'
 ),note:request.note??''
});

export function buildManualLedgerIntent(request:ManualRecordRequest,now:string):LedgerIntent{
 const common=base(request,now);
 if(request.action==='SPEND'){
  if(request.funding==='EXTERNAL_SPONSOR'&&(request.payer!==null||request.payerAllocations?.length))throw Error('SPONSOR_HAS_OWN_ACCOUNT');
  return {...common,kind:'PURCHASE',payer:request.payer,payerAllocations:request.payerAllocations,categoryId:request.categoryId,funding:request.funding??'OWN'};
 }
 if(request.action==='RECEIVE'){
  if(request.meaning==='REFUND'){
   if(request.funding==='EXTERNAL_SPONSOR'&&(request.destination!==null||request.destinationAllocations?.length))throw Error('SPONSORED_REFUND_HAS_OWN_ACCOUNT');
   return {...common,kind:'REFUND',destination:request.destination,destinationAllocations:request.destinationAllocations,originalId:request.originalId??null,funding:request.funding??'OWN',categoryId:request.categoryId};
  }
  return {...common,kind:'INCOME',destination:request.destination};
 }
 switch(request.meaning){
  case 'BETWEEN_OWN':return {...common,kind:'INTERNAL_TRANSFER',from:request.from,to:request.to};
  case 'TO_OTHER':return {...common,kind:'EXTERNAL_TRANSFER',from:request.from,consumptionAmount:request.consumptionAmount??0,categoryId:request.categoryId};
  case 'REPAYMENT':return {...common,kind:'REPAYMENT',from:request.from,to:request.to};
  case 'WITHDRAWAL':return {...common,kind:'WITHDRAWAL',from:request.from,to:request.to,fee:request.fee??0};
 }
}
