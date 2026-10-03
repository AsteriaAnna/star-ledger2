import type {Command,LedgerSnapshot} from '../accounting/index.ts';
import {correctionSnapshot} from '../accounting/business.ts';

export type DetailFields={name:string;note:string;category:string|null};
export type DetailEditRequest={transactionId:string;expectedSnapshot:string;changedFields:Partial<DetailFields>};
export function transactionEditContext(snapshot:LedgerSnapshot,transactionId:string){
 const transaction=snapshot.entities.find(e=>e.type==='transactions'&&e.id===transactionId&&!e.fields.deleted_at&&!e.fields.purged_at);
 if(!transaction)throw Error('TRANSACTION_UNAVAILABLE');
 const effects=snapshot.entities.filter(e=>e.type==='consumption_effects'&&e.fields.transaction_id===transactionId);
 return {transaction,expectedSnapshot:correctionSnapshot(snapshot.entities,transactionId),fields:{name:String(transaction.fields.display_name??''),note:String(transaction.fields.note??''),category:effects.length===1?String(effects[0].fields.category_id??'其他'):null} as DetailFields};
}

// Metadata-only edit boundary for M5.2-A. Financial fields use Correction Service in M5.2-B/C.
export function planDetailEdit(request:DetailEditRequest,snapshot:LedgerSnapshot):Command[]{
 const current=transactionEditContext(snapshot,request.transactionId);
 if(current.expectedSnapshot!==request.expectedSnapshot)throw Error('STALE_TRANSACTION');
 if(snapshot.conflicts.length)throw Error('UNRESOLVED_CONFLICT');
 const changes=request.changedFields;
 if(!changes||typeof changes!=='object'||Object.keys(changes).some(k=>!['name','note','category'].includes(k)))throw Error('INVALID_DETAIL_EDIT');
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
 return commands;
}
