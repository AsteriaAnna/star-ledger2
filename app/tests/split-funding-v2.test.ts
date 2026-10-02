import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessAccountingService,correctionSnapshot} from '../packages/accounting/business.ts';
import {planTransactionCorrection} from '../packages/application/correction-service.ts';
import {accountBalance,consumptionInPeriod} from '../packages/analytics/index.ts';
import {project} from '../packages/sync/projection.ts';
import {pair} from './helpers.ts';

const start='2026-09-01T00:00:00Z',at='2026-09-10T10:00:00Z',refundAt='2026-09-20T10:00:00Z',end='2026-10-01T00:00:00Z';
function setup(t:Parameters<typeof pair>[0]){
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 for(const id of ['wallet','bank'])service.execute({kind:'CREATE_ACCOUNT',id,name:id,accountType:'ASSET',openingBalance:50000,openingBalanceAt:start});
 return {...p,service,snapshot:()=>project(p.a.store.allOperations())};
}
test('split purchase posts one transaction with exact funding movements and one consumption effect',t=>{
 const x=setup(t);
 x.service.execute({kind:'PURCHASE',id:'buy',name:'split',amount:10000,payer:null,payerAllocations:[{accountId:'wallet',amount:3000},{accountId:'bank',amount:7000}],occurredAt:at,categoryId:'餐饮'});
 const snap=x.snapshot(),moves=snap.entities.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id==='buy');
 assert.deepEqual(moves.map(e=>[e.fields.account_id,e.fields.amount]),[['wallet',-3000],['bank',-7000]]);
 assert.equal(consumptionInPeriod(snap,start,end),10000);assert.equal(accountBalance(snap,'wallet',end).balance,47000);assert.equal(accountBalance(snap,'bank',end).balance,43000);
});
test('split funding must conserve the transaction amount',t=>{
 const x=setup(t);
 assert.throws(()=>x.service.execute({kind:'PURCHASE',id:'bad',name:'bad',amount:10000,payer:null,payerAllocations:[{accountId:'wallet',amount:3000},{accountId:'bank',amount:6000}],occurredAt:at}),/ALLOCATION_SUM_MISMATCH/);
});
test('one account cannot appear twice in one allocation because that hides an unresolved decomposition',t=>{
 const x=setup(t);
 assert.throws(()=>x.service.execute({kind:'PURCHASE',id:'bad',name:'bad',amount:10000,payer:null,payerAllocations:[{accountId:'wallet',amount:3000},{accountId:'wallet',amount:7000}],occurredAt:at}),/DUPLICATE_ALLOCATION_ACCOUNT/);
});
test('split refund changes balances but reduces consumption only once',t=>{
 const x=setup(t);
 x.service.execute({kind:'PURCHASE',id:'buy',name:'split',amount:10000,payer:null,payerAllocations:[{accountId:'wallet',amount:3000},{accountId:'bank',amount:7000}],occurredAt:at,categoryId:'餐饮'});
 x.service.execute({kind:'REFUND',id:'refund',name:'refund',amount:4000,originalId:'buy',destination:null,destinationAllocations:[{accountId:'wallet',amount:1000},{accountId:'bank',amount:3000}],occurredAt:refundAt});
 const snap=x.snapshot();
 assert.equal(consumptionInPeriod(snap,start,end),6000);assert.equal(accountBalance(snap,'wallet',end).balance,48000);assert.equal(accountBalance(snap,'bank',end).balance,46000);
});
test('correction atomically replaces a single payer with split funding',t=>{
 const x=setup(t);
 x.service.execute({kind:'PURCHASE',id:'buy',name:'single',amount:10000,payer:'bank',occurredAt:at,categoryId:'餐饮'});
 const before=x.snapshot(),plan=planTransactionCorrection({transactionId:'buy',replacement:{kind:'PURCHASE',id:'buy',name:'split',amount:10000,payer:null,payerAllocations:[{accountId:'wallet',amount:2500},{accountId:'bank',amount:7500}],occurredAt:at,categoryId:'餐饮'},expectedSnapshot:correctionSnapshot(before.entities,'buy'),correctedAt:'2026-10-02T00:00:00Z'},before);
 x.service.executeBatch(plan.commands);const snap=x.snapshot();
 const active=snap.entities.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id==='buy'&&!e.fields.deleted_at&&e.fields.amount!==0);
 assert.deepEqual(active.map(e=>[e.fields.account_id,e.fields.amount]).sort(),[['bank',-7500],['wallet',-2500]].sort());
 assert.equal(accountBalance(snap,'wallet',end).balance,47500);assert.equal(accountBalance(snap,'bank',end).balance,42500);assert.equal(consumptionInPeriod(snap,start,end),10000);
});


test('split refund can detach and relink without collapsing its funding destinations',t=>{
 const x=setup(t);
 x.service.execute({kind:'PURCHASE',id:'buy',name:'split',amount:10000,payer:null,payerAllocations:[{accountId:'wallet',amount:3000},{accountId:'bank',amount:7000}],occurredAt:at,categoryId:'餐饮'});
 x.service.execute({kind:'REFUND',id:'refund',name:'refund',amount:4000,originalId:'buy',destination:null,destinationAllocations:[{accountId:'wallet',amount:1000},{accountId:'bank',amount:3000}],occurredAt:refundAt});
 x.service.execute({kind:'UNLINK_RETURN',transactionId:'refund',detachedAt:'2026-09-21T00:00:00Z'});
 x.service.execute({kind:'LINK_RETURN',transactionId:'refund',originalId:'buy'});
 const snap=x.snapshot(),moves=snap.entities.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id==='refund'&&e.fields.amount!==0);
 assert.deepEqual(moves.map(e=>[e.fields.account_id,e.fields.amount]).sort(),[['bank',3000],['wallet',1000]].sort());
 assert.equal(consumptionInPeriod(snap,start,end),6000);
});
