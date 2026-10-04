import type {Command,LedgerSnapshot} from '../accounting/index.ts';
import type {BalanceAllocation,LedgerIntent} from '../domain/accounting.ts';
import {transactionIntent} from '../accounting/transaction-intent.ts';
import {applyCommands,correctionSnapshot,interpret} from '../accounting/business.ts';
import {planTransactionCorrection} from './correction-service.ts';
export type FinancialFields={amount:string;occurredAt:string;meaning:string;funding:string;account:string;to:string;fee:string;consumption:string;allocations:string};
export const financialFieldNames=['amount','occurredAt','meaning','funding','account','to','fee','consumption','allocations'] as const;
const moneyText=(n:number)=>(n/100).toFixed(2);
const parseMoney=(s:string,zero=false)=>{if(!/^\d+(\.\d{1,2})?$/.test(s))throw Error('INVALID_MONEY');const [whole,fraction='']=s.split('.');const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(amount)||(zero?amount<0:amount<=0))throw Error('INVALID_MONEY');return amount;};
export function financialEditFields(snapshot:LedgerSnapshot,id:string):FinancialFields|null{
 let intent:LedgerIntent;try{intent=transactionIntent(snapshot,id);}catch(e){if(e instanceof Error&&['EDIT_FINANCIAL_STRUCTURE_UNAVAILABLE','INVALID_POSTING_PLAN'].includes(e.message))return null;throw e;}
 const account='payer'in intent?intent.payer:'destination'in intent?intent.destination:intent.from;
 const allocations='payerAllocations'in intent?intent.payerAllocations:'destinationAllocations'in intent?intent.destinationAllocations:undefined;
 return {amount:moneyText(intent.amount),occurredAt:new Date(intent.occurredAt).toISOString(),meaning:intent.kind,funding:'funding'in intent?intent.funding??'OWN':'OWN',account:account??'',to:'to'in intent?intent.to??'':'',fee:'fee'in intent?moneyText(intent.fee):'0.00',consumption:'consumptionAmount'in intent?moneyText(intent.consumptionAmount??0):'0.00',allocations:JSON.stringify(allocations??[])};
}
export function planFinancialEdit(snapshot:LedgerSnapshot,id:string,changes:Partial<FinancialFields>&{name?:string;note?:string;category?:string|null},now:string):Command[]{
 const original=transactionIntent(snapshot,id),fields=financialEditFields(snapshot,id)!;
 const v={...fields,...changes};
 if(financialFieldNames.some(k=>typeof v[k]!=='string')||!['OWN','EXTERNAL_SPONSOR'].includes(v.funding))throw Error('INVALID_DETAIL_EDIT');
 const base={id,name:changes.name??original.name,note:changes.note??original.note,amount:parseMoney(v.amount),occurredAt:v.occurredAt,status:original.status};
 const categoryId=changes.category??('categoryId'in original?original.categoryId:undefined);
 let allocations:BalanceAllocation[];try{const parsed=JSON.parse(v.allocations);allocations=Array.isArray(parsed)?parsed.map((a:any)=>({...a,amount:typeof a?.amountText==='string'?parseMoney(a.amountText):a?.amount})):parsed;}catch{throw Error('INVALID_ALLOCATION');}
 if(!Array.isArray(allocations)||allocations.some(a=>!a||!(a.accountId===null||typeof a.accountId==='string')||!Number.isSafeInteger(a.amount)||a.amount<=0))throw Error('INVALID_ALLOCATION');
 const account=v.account||null,to=v.to||null;
 let replacement:LedgerIntent;
 switch(v.meaning){
  case 'PURCHASE':replacement={...base,kind:'PURCHASE',payer:allocations.length?null:account,payerAllocations:allocations.length?allocations:undefined,funding:v.funding as 'OWN'|'EXTERNAL_SPONSOR',categoryId};break;
  case 'INCOME':case 'TRANSFER_IN':replacement={...base,kind:v.meaning,destination:account};break;
  case 'INTERNAL_TRANSFER':case 'REPAYMENT':replacement={...base,kind:v.meaning,from:account,to};break;
  case 'WITHDRAWAL':replacement={...base,kind:'WITHDRAWAL',from:account,to,fee:parseMoney(v.fee,true)};break;
  case 'EXTERNAL_TRANSFER':case 'DEPOSIT':case 'RED_PACKET':replacement={...base,kind:v.meaning,from:account,consumptionAmount:parseMoney(v.consumption,true),categoryId};break;
  case 'REFUND':case 'RETURN':replacement={...base,kind:v.meaning,originalId:'originalId'in original?original.originalId:null,destination:allocations.length?null:account,destinationAllocations:allocations.length?allocations:undefined,funding:v.funding as 'OWN'|'EXTERNAL_SPONSOR',categoryId};break;
  default:throw Error('INVALID_DETAIL_EDIT');
 }
 if(allocations.length&&!['PURCHASE','REFUND','RETURN'].includes(v.meaning))throw Error('REMOVE_SPLIT_BEFORE_KIND_CHANGE');
 const correction=planTransactionCorrection({transactionId:id,replacement,expectedSnapshot:correctionSnapshot(snapshot.entities,id),correctedAt:now},snapshot);
 let working=snapshot;const commands:Command[]=[];
 for(const command of correction.commands){const next=interpret(command,working);commands.push(...next);working=applyCommands(working,next);}
 // Unlinked refunds and persisted link tombstones are the durable review facts.
 // The query/UI derives follow-ups from these facts instead of inventing another workflow queue.
 return commands;
}
