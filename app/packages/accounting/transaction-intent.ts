import type {LedgerSnapshot} from './index.ts';
import type {LedgerIntent,AccountRef} from '../domain/accounting.ts';
import {pendingPostings} from './business.ts';

/** Reconstruct existing financial intent from effective postings, never from display labels. */
export function transactionIntent(snapshot:LedgerSnapshot,id:string):LedgerIntent{
 const t=snapshot.entities.find(e=>e.type==='transactions'&&e.id===id&&!e.fields.deleted_at&&!e.fields.purged_at);
 if(!t)throw Error('TRANSACTION_UNAVAILABLE');
 if(!['SUCCESS','PENDING'].includes(String(t.fields.status)))throw Error('EDIT_FINANCIAL_STRUCTURE_UNAVAILABLE');
 const postings=t.fields.status==='PENDING'?pendingPostings(t):snapshot.entities;
 const movements=postings.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id===id&&e.fields.amount!==0).map(e=>({accountId:e.fields.account_id as AccountRef,flow:Number(e.fields.amount)*(snapshot.entities.find(a=>a.type==='accounts'&&a.id===e.fields.account_id)?.fields.type==='LIABILITY'?-1:1)}));
 const out=movements.filter(m=>m.flow<0),incoming=movements.filter(m=>m.flow>0);
 const effects=postings.filter(e=>e.type==='consumption_effects'&&e.fields.transaction_id===id);
 if(effects.length>1)throw Error('EDIT_FINANCIAL_STRUCTURE_UNAVAILABLE');
 const categoryId=typeof effects[0]?.fields.category_id==='string'?effects[0].fields.category_id:undefined;
 const base={id,name:String(t.fields.display_name),note:String(t.fields.note),occurredAt:String(t.fields.occurred_at),amount:Number(t.fields.display_amount),status:t.fields.status as 'SUCCESS'|'PENDING'};
 const requireShape=(condition:boolean)=>{if(!condition)throw Error('EDIT_FINANCIAL_STRUCTURE_UNAVAILABLE');};
 const allocations=(rows:typeof movements)=>rows.map(m=>({accountId:m.accountId,amount:Math.abs(m.flow)}));
 switch(t.fields.event_type){
  case 'PURCHASE':
   requireShape(incoming.length===0&&(!out.length||out.reduce((n,m)=>n-m.flow,0)===base.amount));
   return {...base,kind:'PURCHASE',payer:out.length===1?out[0].accountId:null,payerAllocations:out.length>1?allocations(out):undefined,funding:out.length?'OWN':'EXTERNAL_SPONSOR',categoryId};
  case 'INCOME':case 'TRANSFER_IN':
   requireShape(out.length===0&&incoming.length===1&&incoming[0].flow===base.amount);
   return {...base,kind:t.fields.event_type,destination:incoming[0].accountId};
  case 'INTERNAL_TRANSFER':case 'REPAYMENT':case 'WITHDRAWAL': {
   requireShape(out.length===1&&incoming.length===1&&incoming[0].flow===base.amount);
   const fee=-out[0].flow-base.amount;requireShape(t.fields.event_type==='WITHDRAWAL'?fee>=0:fee===0);
   return t.fields.event_type==='WITHDRAWAL'?{...base,kind:'WITHDRAWAL',from:out[0].accountId,to:incoming[0].accountId,fee}:{...base,kind:t.fields.event_type,from:out[0].accountId,to:incoming[0].accountId};
  }
  case 'EXTERNAL_TRANSFER':case 'DEPOSIT':case 'RED_PACKET':
   requireShape(out.length===1&&incoming.length===0&&-out[0].flow===base.amount);
   return {...base,kind:t.fields.event_type,from:out[0].accountId,consumptionAmount:Number(effects[0]?.fields.amount??0),categoryId};
  case 'REFUND':case 'RETURN': {
   requireShape(out.length===0&&(!incoming.length||incoming.reduce((n,m)=>n+m.flow,0)===base.amount));
   const link=postings.find(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.from_transaction_id===id);
   return {...base,kind:t.fields.event_type,originalId:link?String(link.fields.to_transaction_id):null,destination:incoming.length===1?incoming[0].accountId:null,destinationAllocations:incoming.length>1?allocations(incoming):undefined,funding:incoming.length?'OWN':'EXTERNAL_SPONSOR',categoryId};
  }
  default:throw Error('EDIT_FINANCIAL_STRUCTURE_UNAVAILABLE');
 }
}
