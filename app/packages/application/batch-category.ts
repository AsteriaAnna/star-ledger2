import type {Command,LedgerSnapshot} from '../accounting/index.ts';
import {applyCommands} from '../accounting/business.ts';
import {lifecycleContext} from './transaction-lifecycle.ts';
import {planDetailEdit,transactionEditContext} from './transaction-edit.ts';
export function batchCategoryContext(snapshot:LedgerSnapshot,ids:readonly string[]){
 const scope=lifecycleContext(snapshot,'DELETE',ids);
 const eligibleIds:string[]=[],skippedIds:string[]=[];
 for(const t of scope.targets){
  const linked=snapshot.entities.some(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.from_transaction_id===t.id);
  const context=transactionEditContext(snapshot,t.id);
  if(!linked&&context.fields.category!==null&&['PURCHASE','WITHDRAWAL','EXTERNAL_TRANSFER','DEPOSIT','RED_PACKET','REFUND','RETURN'].includes(String(t.fields.event_type)))eligibleIds.push(t.id);
  else skippedIds.push(t.id);
 }
 return {...scope,eligibleIds,skippedIds};
}
export function planBatchCategory(request:{transactionIds:string[];expectedSnapshot:string;category:string},snapshot:LedgerSnapshot):Command[]{
 const context=batchCategoryContext(snapshot,request.transactionIds);
 if(context.expectedSnapshot!==request.expectedSnapshot)throw Error('STALE_BATCH_SELECTION');
 if(!context.eligibleIds.length)throw Error('CATEGORY_EDIT_UNAVAILABLE');
 let working=snapshot;const commands:Command[]=[];
 for(const id of context.eligibleIds){
  const next=planDetailEdit({transactionId:id,expectedSnapshot:transactionEditContext(working,id).expectedSnapshot,changedFields:{category:request.category}},working);
  working=applyCommands(working,next);commands.push(...next);
 }
 return commands;
}
