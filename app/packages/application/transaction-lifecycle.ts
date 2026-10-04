import type {Command,LedgerSnapshot} from '../accounting/index.ts';
import {applyCommands,correctionSnapshot,interpret} from '../accounting/business.ts';
import type {BusinessCommand} from '../domain/accounting.ts';
export type LifecycleAction='DELETE'|'RESTORE';
export type LifecycleRequest={action:LifecycleAction;transactionIds:string[];expectedSnapshot:string;now:string};
/** Freeze the selected scope and related financial facts, including legacy deleted returns. */
export function lifecycleContext(snapshot:LedgerSnapshot,action:LifecycleAction,ids:readonly string[]){
 if(snapshot.conflicts.length)throw Error('UNRESOLVED_CONFLICT');
 const transactionIds=[...new Set(ids)].sort();if(!transactionIds.length)throw Error('EMPTY_SELECTION');
 const targets=transactionIds.map(id=>{
  const row=snapshot.entities.find(e=>e.type==='transactions'&&e.id===id);
  if(!row||row.fields.purged_at||Boolean(row.fields.deleted_at)!==(action==='RESTORE'))throw Error('TRANSACTION_UNAVAILABLE');
  return row;
 });
 const related=new Set(transactionIds);
 for(const e of snapshot.entities.filter(e=>e.type==='transaction_links'))if(related.has(String(e.fields.to_transaction_id))||transactionIds.includes(String(e.fields.from_transaction_id))){related.add(String(e.fields.from_transaction_id));related.add(String(e.fields.to_transaction_id));}
 const expectedSnapshot=JSON.stringify([action,transactionIds,[...related].sort().map(id=>correctionSnapshot(snapshot.entities,id))]);
 const affectedRefundIds=snapshot.entities.filter(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&(transactionIds.includes(String(e.fields.from_transaction_id))||transactionIds.includes(String(e.fields.to_transaction_id)))).map(e=>String(e.fields.from_transaction_id));
 return {transactionIds,expectedSnapshot,targets,affectedRefundIds:[...new Set(affectedRefundIds)]};
}
export function planTransactionLifecycle(request:LifecycleRequest,snapshot:LedgerSnapshot):Command[]{
 const context=lifecycleContext(snapshot,request.action,request.transactionIds);
 if(context.expectedSnapshot!==request.expectedSnapshot)throw Error('STALE_BATCH_SELECTION');
 let working=snapshot;const commands:Command[]=[];
 const advance=(command:BusinessCommand)=>{const next=interpret(command,working);working=applyCommands(working,next);commands.push(...next);};
 if(request.action==='RESTORE'){
  for(const id of context.transactionIds)advance({kind:'RESTORE_TRANSACTION',transactionId:id});
  // Old versions left active links on deleted refunds. Restore their facts first,
  // then detach the relation; never revive a link to a deleted/changed original.
  for(const id of context.transactionIds){const tx=working.entities.find(e=>e.type==='transactions'&&e.id===id)!;
   if(tx.fields.status==='SUCCESS'&&['REFUND','RETURN'].includes(String(tx.fields.event_type)))advance({kind:'UNLINK_RETURN',transactionId:id,detachedAt:request.now});
  }
 }else{
  for(const id of context.affectedRefundIds){const tx=working.entities.find(e=>e.type==='transactions'&&e.id===id);
   if(tx&&!tx.fields.deleted_at&&tx.fields.status==='SUCCESS')advance({kind:'UNLINK_RETURN',transactionId:id,detachedAt:request.now});
  }
  for(const id of context.transactionIds)advance({kind:'DELETE_TRANSACTION',transactionId:id,deletedAt:request.now});
 }
 return commands;
}
