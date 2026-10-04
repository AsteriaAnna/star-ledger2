import {relationDecision} from './refund-relations.ts';
import {financialEditFields,financialFieldNames,planFinancialEdit,type FinancialFields} from './transaction-financial-edit.ts';
import type {Command,LedgerSnapshot} from '../accounting/index.ts';
import {correctionSnapshot,pendingPostings} from '../accounting/business.ts';

export type DetailFields={name:string;note:string;category:string|null}&Partial<FinancialFields>;
export const detailFieldNames=['name','note','category',...financialFieldNames] as const;
export type DetailEditRequest={transactionId:string;expectedSnapshot:string;changedFields:Partial<DetailFields>};
export function transactionEditContext(snapshot:LedgerSnapshot,transactionId:string){
 const transaction=snapshot.entities.find(e=>e.type==='transactions'&&e.id===transactionId&&!e.fields.deleted_at&&!e.fields.purged_at);
 if(!transaction)throw Error('TRANSACTION_UNAVAILABLE');
 const financial=financialEditFields(snapshot,transactionId);
 const postings=financial&&transaction.fields.status==='PENDING'&&transaction.fields.posting_plan?pendingPostings(transaction):snapshot.entities;
 const effects=postings.filter(e=>e.type==='consumption_effects'&&e.fields.transaction_id===transactionId);
 return {transaction,expectedSnapshot:correctionSnapshot(snapshot.entities,transactionId),fields:{name:String(transaction.fields.display_name??''),note:String(transaction.fields.note??''),category:effects.length===1?String(effects[0].fields.category_id??'其他'):financial?'其他':null,...(financial??{})} as DetailFields};
}

// Changed-field boundary: financial changes are planned through Correction Service.
export function planDetailEdit(request:DetailEditRequest,snapshot:LedgerSnapshot):Command[]{
 const current=transactionEditContext(snapshot,request.transactionId);
 if(current.expectedSnapshot!==request.expectedSnapshot)throw Error('STALE_TRANSACTION');
 if(snapshot.conflicts.length)throw Error('UNRESOLVED_CONFLICT');
 const changes=request.changedFields;
 if(!changes||typeof changes!=='object'||Object.keys(changes).some(k=>!(detailFieldNames as readonly string[]).includes(k)))throw Error('INVALID_DETAIL_EDIT');
 const recordUserFields=(commands:Command[])=>{
  if(!commands.length)return commands;
  let previous:string[]=[];
  if(current.transaction.fields.user_edits){try{const parsed=JSON.parse(String(current.transaction.fields.user_edits));if(parsed.version!==1||!Array.isArray(parsed.fields)||parsed.fields.some((k:unknown)=>typeof k!=='string'))throw Error();previous=parsed.fields;}catch{throw Error('INVALID_USER_EDIT_HISTORY');}}
  const edited=[...new Set([...previous,...Object.keys(changes)])].sort();
  const value=JSON.stringify({version:1,fields:edited});
  return current.transaction.fields.user_edits===value?commands:[...commands,{action:'PATCH_FIELD' as const,entity:{type:'transactions' as const,id:request.transactionId,fields:{user_edits:value}}}];
 };
 const keys=Object.keys(changes);
 if(keys.some(k=>typeof changes[k as keyof DetailFields]!=='string'))throw Error('INVALID_DETAIL_EDIT');
 if(changes.name!==undefined&&(!changes.name.trim()||changes.name.length>100)||changes.note!==undefined&&changes.note.length>1000||changes.category!==undefined&&(changes.category===null||!changes.category.trim()||changes.category.length>100))throw Error('INVALID_DETAIL_EDIT');
 if(keys.some(k=>(financialFieldNames as readonly string[]).includes(k))||(Object.hasOwn(changes,'category')&&current.fields.amount!==undefined))return recordUserFields(planFinancialEdit(snapshot,request.transactionId,changes,new Date().toISOString()));
 const commands:Command[]=[];
 for(const [key,value] of Object.entries(changes)){
  if(typeof value!=='string'||(key==='name'&&(!value.trim()||value.length>100))||(key==='note'&&value.length>1000)||(key==='category'&&(!value.trim()||value.length>100)))throw Error('INVALID_DETAIL_EDIT');
  if(value===current.fields[key as keyof DetailFields])continue;
  if(key==='category'){
   if(current.fields.category===null)throw Error('CATEGORY_EDIT_UNAVAILABLE');
   const effect=snapshot.entities.find(e=>e.type==='consumption_effects'&&e.fields.transaction_id===request.transactionId)!;
   commands.push({action:'PATCH_FIELD',entity:{type:'consumption_effects',id:effect.id,fields:{category_id:value}}});
  }else commands.push({action:'PATCH_FIELD',entity:{type:'transactions',id:request.transactionId,fields:{[key==='name'?'display_name':'note']:value}}});
 }
 return recordUserFields(commands);
}

/** A persisted detached relationship is sufficient to recover its question after reload/sync. */
export function detachedRefundReviews(snapshot:LedgerSnapshot){
 const links=snapshot.entities.filter(e=>e.type==='transaction_links');
 const detached=new Set(links.filter(e=>e.fields.deleted_at).map(e=>e.fields.from_transaction_id));
 const active=new Set(links.filter(e=>!e.fields.deleted_at).map(e=>e.fields.from_transaction_id));
 return snapshot.entities.filter(e=>e.type==='transactions'&&!e.fields.deleted_at&&!e.fields.purged_at&&e.fields.status==='SUCCESS'&&['REFUND','RETURN'].includes(String(e.fields.event_type))&&detached.has(e.id)&&!active.has(e.id)&&relationDecision(snapshot,e.id)?.originalId!==null).map(e=>({id:e.id,name:String(e.fields.display_name)}));
}
