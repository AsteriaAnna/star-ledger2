import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {refundRelationContext,planRefundRelation,relatedTransactions} from '../packages/application/refund-relations.ts';
import {lifecycleContext,planTransactionLifecycle} from '../packages/application/transaction-lifecycle.ts';
import {detachedRefundReviews,planDetailEdit,transactionEditContext} from '../packages/application/transaction-edit.ts';
const at='2026-10-04T01:00:00Z';
function fixture(){
 const store=new MemoryStore(fresh()),business=new BusinessAccountingService(store,store.state.device),service=new AccountingService(store,store.state.device);
 business.execute({kind:'CREATE_ACCOUNT',id:'bank',name:'银行卡',accountType:'ASSET',openingBalance:0,openingBalanceAt:at});
 for(const [id,categoryId] of [['p','餐饮'],['q','购物']])business.execute({kind:'PURCHASE',id,name:id,amount:2000,payer:'bank',categoryId,occurredAt:'2026-09-30T01:00:00Z'});
 business.execute({kind:'REFUND',id:'r',name:'跨月退款',amount:500,destination:'bank',originalId:'p',occurredAt:at});
 const snap=()=>({entities:store.entities,conflicts:store.conflicts});
 const choose=(originalId:string|null)=>service.execute(s=>planRefundRelation({transactionId:'r',originalId,expectedSnapshot:refundRelationContext(s,'r').expectedSnapshot,now:at},s));
 const lifecycle=(action:'DELETE'|'RESTORE',ids:string[])=>service.execute(s=>planTransactionLifecycle({action,transactionIds:ids,expectedSnapshot:lifecycleContext(s,action,ids).expectedSnapshot,now:at},s));
 return {store,business,service,snap,choose,lifecycle};
}
test('changing and removing original relation retains money, dates and source facts while updating contribution category',()=>{
 const h=fixture(),money=structuredClone(h.store.entities.filter(e=>e.type==='balance_movements')),refund=structuredClone(h.store.entities.find(e=>e.id==='r'));
 assert.deepEqual(relatedTransactions(h.snap(),'r').map(e=>e.transaction?.id),['p']);h.choose('q');assert.deepEqual(relatedTransactions(h.snap(),'q').map(e=>e.transaction?.id),['r']);
 assert.equal(h.store.entities.find(e=>e.id==='r:effect')?.fields.category_id,'购物');h.choose(null);
 assert.deepEqual(h.store.entities.filter(e=>e.type==='balance_movements'),money);assert.deepEqual(h.store.entities.find(e=>e.id==='r'),refund);assert.deepEqual(detachedRefundReviews(h.snap()),[]);
});
test('candidate selection excludes over-limit and later originals, includes current relation without double counting',()=>{
 const h=fixture();h.business.execute({kind:'PURCHASE',id:'small',name:'小额',amount:100,payer:'bank',occurredAt:at});h.business.execute({kind:'PURCHASE',id:'late',name:'晚于退款',amount:2000,payer:'bank',occurredAt:'2026-10-05T01:00:00Z'});
 assert.deepEqual(new Set(refundRelationContext(h.snap(),'r').candidates.map(e=>e.id)),new Set(['p','q']));
});
test('stale relation form refuses a changed candidate and write failure rolls back unlink and new link',()=>{
 const h=fixture(),request={transactionId:'r',originalId:'q',expectedSnapshot:refundRelationContext(h.snap(),'r').expectedSnapshot,now:at};
 const before=structuredClone(h.store.state),append=h.store.append.bind(h.store);h.store.append=(op,local)=>{append(op,local);throw Error('WRITE_FAILURE');};
 assert.throws(()=>h.service.execute(s=>planRefundRelation(request,s)),/WRITE_FAILURE/);assert.deepEqual(h.store.state,before);h.store.append=append;
 h.service.execute(s=>planDetailEdit({transactionId:'q',expectedSnapshot:transactionEditContext(s,'q').expectedSnapshot,changedFields:{amount:'4'}},s));assert.throws(()=>h.service.execute(s=>planRefundRelation(request,s)),/STALE_REFUND_RELATION/);
});
test('restoration reconnects valid historical relationships but never reverses an explicit user unlink',()=>{
 const h=fixture();h.lifecycle('DELETE',['p']);h.lifecycle('RESTORE',['p']);assert.deepEqual(relatedTransactions(h.snap(),'r').map(e=>e.transaction?.id),['p']);
 h.choose(null);h.lifecycle('DELETE',['p']);h.lifecycle('RESTORE',['p']);assert.deepEqual(relatedTransactions(h.snap(),'r'),[]);assert.deepEqual(detachedRefundReviews(h.snap()),[]);
});
test('over-limit restored refund set is kept entirely unlinked instead of choosing by iteration order',()=>{
 const h=fixture();h.business.execute({kind:'REFUND',id:'r2',name:'第二退款',amount:500,destination:'bank',originalId:'p',occurredAt:at});h.lifecycle('DELETE',['r','r2']);
 h.service.execute(s=>planDetailEdit({transactionId:'p',expectedSnapshot:transactionEditContext(s,'p').expectedSnapshot,changedFields:{amount:'7'}},s));h.lifecycle('RESTORE',['r','r2']);
 assert.deepEqual(relatedTransactions(h.snap(),'p'),[]);assert.equal(detachedRefundReviews(h.snap()).length,2);assert.equal(h.store.conflicts.length,0);
});

test('legacy refund restoration revalidates its still active old relation',()=>{
 const h=fixture();h.business.execute({kind:'DELETE_TRANSACTION',transactionId:'r',deletedAt:'2026-10-03T01:00:00Z'});h.lifecycle('RESTORE',['r']);
 assert.deepEqual(relatedTransactions(h.snap(),'r').map(e=>e.transaction?.id),['p']);assert.equal(h.store.conflicts.length,0);
});
