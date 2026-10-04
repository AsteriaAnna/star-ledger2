import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {lifecycleContext,planTransactionLifecycle,type LifecycleAction} from '../packages/application/transaction-lifecycle.ts';
import {planDetailEdit,transactionEditContext,detachedRefundReviews} from '../packages/application/transaction-edit.ts';
const at='2026-10-04T01:00:00Z';
function fixture(){
 const store=new MemoryStore(fresh()),business=new BusinessAccountingService(store,store.state.device),service=new AccountingService(store,store.state.device);
 business.execute({kind:'PURCHASE',id:'p',name:'消费',amount:2000,payer:null,categoryId:'餐饮',occurredAt:at});
 business.execute({kind:'REFUND',id:'r',name:'退款',amount:500,destination:null,originalId:'p',occurredAt:at});
 const snap=()=>({entities:store.entities,conflicts:store.conflicts});
 const request=(action:LifecycleAction,ids:string[])=>({action,transactionIds:ids,expectedSnapshot:lifecycleContext(snap(),action,ids).expectedSnapshot,now:at});
 const execute=(r:ReturnType<typeof request>)=>service.execute(s=>planTransactionLifecycle(r,s));
 const get=(id:string)=>store.entities.find(e=>e.type==='transactions'&&e.id===id)!;
 return {store,business,service,snap,request,execute,get};
}
test('deleting an original detaches its refund atomically without deleting refund financial facts',()=>{
 const h=fixture(),movements=structuredClone(h.store.entities.filter(e=>e.type==='balance_movements'));
 h.execute(h.request('DELETE',['p']));assert.equal(h.get('p').fields.deleted_at,at);assert.equal(h.get('r').fields.deleted_at,null);
 assert.deepEqual(h.store.entities.filter(e=>e.type==='balance_movements'),movements);assert.deepEqual(detachedRefundReviews(h.snap()).map(r=>r.id),['r']);assert.equal(h.store.conflicts.length,0);
});
test('batch deletion and restoration retain edits and scope, including original and refund selected together',()=>{
 const h=fixture();h.service.execute(s=>planDetailEdit({transactionId:'p',expectedSnapshot:transactionEditContext(s,'p').expectedSnapshot,changedFields:{amount:'25',note:'已改'}},s));
 const marker=h.get('p').fields.user_edits;
 h.execute(h.request('DELETE',['p','r','p']));h.execute(h.request('RESTORE',['p','r']));
 assert.equal(h.get('p').fields.display_amount,2500);assert.equal(h.get('p').fields.note,'已改');assert.equal(h.get('p').fields.user_edits,marker);
 assert.equal(h.get('r').fields.deleted_at,null);assert.equal(h.store.conflicts.length,0);assert.deepEqual(detachedRefundReviews(h.snap()),[]);assert.ok(h.store.entities.some(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.from_transaction_id==='r'));
});
test('changed relation facts after preview reject the whole stale selection',()=>{
 const h=fixture(),request=h.request('DELETE',['p']);h.service.execute(s=>planDetailEdit({transactionId:'r',expectedSnapshot:transactionEditContext(s,'r').expectedSnapshot,changedFields:{note:'另一窗口修改'}},s));
 const before=structuredClone(h.store.state);assert.throws(()=>h.execute(request),/STALE_BATCH_SELECTION/);assert.deepEqual(h.store.state,before);
});
test('legacy deleted refund with an active link is restored safely after its original was deleted',()=>{
 const h=fixture();h.business.execute({kind:'DELETE_TRANSACTION',transactionId:'r',deletedAt:at});h.business.execute({kind:'DELETE_TRANSACTION',transactionId:'p',deletedAt:at});
 h.execute(h.request('RESTORE',['r']));assert.equal(h.get('p').fields.deleted_at,at);assert.equal(h.get('r').fields.deleted_at,null);assert.equal(h.store.conflicts.length,0);assert.deepEqual(detachedRefundReviews(h.snap()).map(r=>r.id),['r']);
});
test('a persistence failure rolls back unlinking and the complete delete batch',()=>{
 const h=fixture(),before=structuredClone(h.store.state),request=h.request('DELETE',['p','r']),append=h.store.append.bind(h.store);let writes=0;
 h.store.append=(op,local)=>{append(op,local);if(++writes===2)throw Error('WRITE_FAILURE');};
 assert.throws(()=>h.execute(request),/WRITE_FAILURE/);assert.deepEqual(h.store.state,before);
});

import {batchCategoryContext,planBatchCategory} from '../packages/application/batch-category.ts';
test('batch category follows original relations and records selected field authority without marking derived refunds',()=>{
 const h=fixture();h.business.execute({kind:'PURCHASE',id:'pending',name:'处理中',status:'PENDING',amount:1000,payer:null,categoryId:'餐饮',occurredAt:at});
 const context=batchCategoryContext(h.snap(),['p','r','pending']);assert.deepEqual(context.skippedIds,['r']);
 h.service.execute(s=>planBatchCategory({transactionIds:context.transactionIds,expectedSnapshot:context.expectedSnapshot,category:'购物'},s));
 for(const id of ['p','r'])assert.equal(h.store.entities.find(e=>e.type==='consumption_effects'&&e.fields.transaction_id===id)?.fields.category_id,'购物');
 assert.deepEqual(JSON.parse(String(h.get('p').fields.user_edits)).fields,['category']);assert.equal(h.get('r').fields.user_edits,null);
 assert.equal(h.store.entities.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id==='pending').length,0);
 assert.equal(JSON.parse(String(h.get('pending').fields.posting_plan)).find((e:any)=>e.type==='consumption_effects').fields.category_id,'购物');
});
test('batch category rejects stale scope and rolls back all selected categories on write failure',()=>{
 const h=fixture(),context=batchCategoryContext(h.snap(),['p','r']),request={transactionIds:context.transactionIds,expectedSnapshot:context.expectedSnapshot,category:'购物'};
 const before=structuredClone(h.store.state),append=h.store.append.bind(h.store);h.store.append=(op,local)=>{append(op,local);throw Error('WRITE_FAILURE');};
 assert.throws(()=>h.service.execute(s=>planBatchCategory(request,s)),/WRITE_FAILURE/);assert.deepEqual(h.store.state,before);h.store.append=append;
 h.business.execute({kind:'UNLINK_RETURN',transactionId:'r',detachedAt:at});assert.throws(()=>h.service.execute(s=>planBatchCategory(request,s)),/STALE_BATCH_SELECTION/);
});
