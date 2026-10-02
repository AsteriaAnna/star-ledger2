import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {accountBalance,consumptionInPeriod} from '../packages/analytics/index.ts';
import {project} from '../packages/sync/projection.ts';
import {pair,converge} from './helpers.ts';

const start='2026-09-01T00:00:00Z',purchaseAt='2026-09-10T10:00:00Z',refundAt='2026-09-20T10:00:00Z',end='2026-10-01T00:00:00Z';
function setup(t:Parameters<typeof pair>[0]){
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute({kind:'CREATE_ACCOUNT',id:'bank',name:'bank',accountType:'ASSET',openingBalance:100000,openingBalanceAt:start});
 const snapshot=()=>project(p.a.store.allOperations());
 return {...p,service,snapshot,spent:()=>consumptionInPeriod(snapshot(),start,end),balance:()=>accountBalance(snapshot(),'bank',end).balance};
}

test('refund relation can detach without deleting either transaction',t=>{
 const x=setup(t);
 x.service.execute({kind:'PURCHASE',id:'buy',name:'buy',amount:10000,payer:'bank',occurredAt:purchaseAt,categoryId:'餐饮'});
 x.service.execute({kind:'REFUND',id:'refund',name:'refund',amount:3000,originalId:'buy',destination:'bank',occurredAt:refundAt});
 assert.equal(x.spent(),7000);assert.equal(x.balance(),93000);
 x.service.execute({kind:'UNLINK_RETURN',transactionId:'refund',detachedAt:'2026-09-21T00:00:00Z'});
 const link=x.a.store.get('transaction_links','refund:link');
 assert.equal(link?.fields.deleted_at,'2026-09-21T00:00:00Z');
 assert.equal(x.a.store.get('transactions','buy')?.fields.deleted_at,null);assert.equal(x.a.store.get('transactions','refund')?.fields.deleted_at,null);
 assert.equal(x.spent(),7000);assert.equal(x.a.store.get('consumption_effects','refund:effect')?.fields.category_id,'待关联退款');
});

test('detached same-target refund can be relinked without creating a second relation',t=>{
 const x=setup(t);
 x.service.execute({kind:'PURCHASE',id:'buy',name:'buy',amount:10000,payer:'bank',occurredAt:purchaseAt,categoryId:'餐饮'});
 x.service.execute({kind:'REFUND',id:'refund',name:'refund',amount:3000,originalId:'buy',destination:'bank',occurredAt:refundAt});
 x.service.execute({kind:'UNLINK_RETURN',transactionId:'refund',detachedAt:'2026-09-21T00:00:00Z'});
 x.service.execute({kind:'LINK_RETURN',transactionId:'refund',originalId:'buy'});
 const links=x.snapshot().entities.filter(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.from_transaction_id==='refund');
 assert.equal(links.length,1);assert.equal(links[0].fields.to_transaction_id,'buy');assert.equal(x.a.store.get('consumption_effects','refund:effect')?.fields.category_id,'餐饮');
});

test('refund can detach from one original and relink to another while history remains',t=>{
 const x=setup(t);
 x.service.execute({kind:'PURCHASE',id:'buy-a',name:'a',amount:10000,payer:'bank',occurredAt:purchaseAt,categoryId:'餐饮'});
 x.service.execute({kind:'PURCHASE',id:'buy-b',name:'b',amount:10000,payer:'bank',occurredAt:purchaseAt,categoryId:'购物'});
 x.service.execute({kind:'REFUND',id:'refund',name:'refund',amount:3000,originalId:'buy-a',destination:'bank',occurredAt:refundAt});
 x.service.execute({kind:'UNLINK_RETURN',transactionId:'refund',detachedAt:'2026-09-21T00:00:00Z'});
 x.service.execute({kind:'LINK_RETURN',transactionId:'refund',originalId:'buy-b'});
 const all=x.snapshot().entities.filter(e=>e.type==='transaction_links'&&e.fields.from_transaction_id==='refund');
 const active=all.filter(e=>!e.fields.deleted_at);
 assert.equal(active.length,1);assert.equal(active[0].fields.to_transaction_id,'buy-b');assert.ok(all.some(e=>e.fields.to_transaction_id==='buy-a'&&e.fields.deleted_at));
 assert.equal(x.a.store.get('consumption_effects','refund:effect')?.fields.category_id,'购物');
});

test('detach lifecycle converges across devices',t=>{
 const x=setup(t);
 x.service.execute({kind:'PURCHASE',id:'buy',name:'buy',amount:10000,payer:'bank',occurredAt:purchaseAt});
 x.service.execute({kind:'REFUND',id:'refund',name:'refund',amount:3000,originalId:'buy',destination:'bank',occurredAt:refundAt});
 converge(x.a,x.b);
 new BusinessAccountingService(x.b.store,'b').execute({kind:'UNLINK_RETURN',transactionId:'refund',detachedAt:'2026-09-21T00:00:00Z'});
 converge(x.a,x.b);
 const a=project(x.a.store.allOperations()),b=project(x.b.store.allOperations());assert.deepEqual(a.entities,b.entities);assert.deepEqual(a.conflicts,b.conflicts);
 assert.equal(a.entities.find(e=>e.type==='transaction_links'&&e.id==='refund:link')?.fields.deleted_at,'2026-09-21T00:00:00Z');
});
