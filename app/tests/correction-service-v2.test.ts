import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessAccountingService,correctionSnapshot} from '../packages/accounting/business.ts';
import {planTransactionCorrection} from '../packages/application/correction-service.ts';
import {accountBalance,consumptionInPeriod} from '../packages/analytics/index.ts';
import {project} from '../packages/sync/projection.ts';
import {pair} from './helpers.ts';

const start='2026-09-01T00:00:00Z',buyAt='2026-09-10T10:00:00Z',refundAt='2026-09-20T10:00:00Z',end='2026-10-01T00:00:00Z';
function setup(t:Parameters<typeof pair>[0]){
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute({kind:'CREATE_ACCOUNT',id:'bank',name:'bank',accountType:'ASSET',openingBalance:100000,openingBalanceAt:start});
 service.execute({kind:'PURCHASE',id:'buy',name:'Lunch',amount:10000,payer:'bank',occurredAt:buyAt,categoryId:'餐饮'});
 service.execute({kind:'REFUND',id:'refund',name:'Refund',amount:3000,originalId:'buy',destination:'bank',occurredAt:refundAt});
 const snapshot=()=>project(p.a.store.allOperations());
 return {...p,service,snapshot,spent:()=>consumptionInPeriod(snapshot(),start,end),balance:()=>accountBalance(snapshot(),'bank',end).balance};
}
const replacement=(amount:number,occurredAt=buyAt,categoryId='餐饮')=>({kind:'PURCHASE' as const,id:'buy',name:'Lunch',amount,payer:'bank',occurredAt,categoryId});

test('linked refund no longer blocks a safe amount correction',t=>{
 const x=setup(t),before=x.snapshot();
 const plan=planTransactionCorrection({transactionId:'buy',replacement:replacement(12000),expectedSnapshot:correctionSnapshot(before.entities,'buy'),correctedAt:'2026-10-02T00:00:00Z'},before);
 assert.deepEqual(plan.relationReviewIds,[]);assert.deepEqual(plan.relinkedReturnIds,['refund']);
 x.service.executeBatch(plan.commands);
 assert.equal(x.spent(),9000);assert.equal(x.balance(),91000);
 const active=x.snapshot().entities.filter(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.from_transaction_id==='refund');assert.equal(active.length,1);
});

test('correction that invalidates the refund set succeeds but leaves the relation for review',t=>{
 const x=setup(t),before=x.snapshot();
 const plan=planTransactionCorrection({transactionId:'buy',replacement:replacement(2000),expectedSnapshot:correctionSnapshot(before.entities,'buy'),correctedAt:'2026-10-02T00:00:00Z'},before);
 assert.deepEqual(plan.relationReviewIds,['refund']);assert.deepEqual(plan.relinkedReturnIds,[]);
 x.service.executeBatch(plan.commands);
 assert.equal(x.a.store.get('transactions','buy')?.fields.display_amount,2000);
 assert.equal(x.snapshot().entities.some(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.from_transaction_id==='refund'),false);
 assert.equal(x.a.store.get('transactions','refund')?.fields.deleted_at,null);
});

test('category correction revalidates relation and moves refund reduction with the original category',t=>{
 const x=setup(t),before=x.snapshot();
 const plan=planTransactionCorrection({transactionId:'buy',replacement:replacement(10000,buyAt,'工作餐'),expectedSnapshot:correctionSnapshot(before.entities,'buy'),correctedAt:'2026-10-02T00:00:00Z'},before);
 x.service.executeBatch(plan.commands);
 assert.deepEqual(plan.relationReviewIds,[]);assert.equal(x.a.store.get('consumption_effects','buy:effect')?.fields.category_id,'工作餐');assert.equal(x.a.store.get('consumption_effects','refund:effect')?.fields.category_id,'工作餐');
});

test('moving original after its refund detaches relation instead of rejecting the whole correction',t=>{
 const x=setup(t),before=x.snapshot();
 const plan=planTransactionCorrection({transactionId:'buy',replacement:replacement(10000,'2026-09-25T10:00:00Z'),expectedSnapshot:correctionSnapshot(before.entities,'buy'),correctedAt:'2026-10-02T00:00:00Z'},before);
 assert.deepEqual(plan.relationReviewIds,['refund']);x.service.executeBatch(plan.commands);
 assert.equal(x.a.store.get('transactions','buy')?.fields.occurred_at,'2026-09-25T10:00:00Z');
});

test('stale user snapshot is rejected before any relation lifecycle plan is created',t=>{
 const x=setup(t),before=x.snapshot();
 assert.throws(()=>planTransactionCorrection({transactionId:'buy',replacement:replacement(12000),expectedSnapshot:'[]',correctedAt:'2026-10-02T00:00:00Z'},before),/STALE_TRANSACTION/);
});


test('ordinary correction does not manufacture a new SourceRecord',t=>{
 const x=setup(t),before=x.snapshot(),sourcesBefore=before.entities.filter(e=>e.type==='source_records').length;
 const plan=planTransactionCorrection({transactionId:'buy',replacement:replacement(11000),expectedSnapshot:correctionSnapshot(before.entities,'buy'),correctedAt:'2026-10-02T00:00:00Z'},before);
 x.service.executeBatch(plan.commands);
 assert.equal(x.snapshot().entities.filter(e=>e.type==='source_records').length,sourcesBefore);
 assert.equal(x.a.store.get('transactions','buy')?.fields.display_amount,11000);
});


test('account correction moves only the corrected purchase movement and preserves linked refund destination',t=>{
 const x=setup(t);x.service.execute({kind:'CREATE_ACCOUNT',id:'wallet',name:'wallet',accountType:'ASSET',openingBalance:50000,openingBalanceAt:start});
 const before=x.snapshot();
 const plan=planTransactionCorrection({transactionId:'buy',replacement:{...replacement(10000),payer:'wallet'},expectedSnapshot:correctionSnapshot(before.entities,'buy'),correctedAt:'2026-10-02T00:00:00Z'},before);
 x.service.executeBatch(plan.commands);
 const after=x.snapshot();
 assert.equal(accountBalance(after,'bank',end).balance,103000);
 assert.equal(accountBalance(after,'wallet',end).balance,40000);
 assert.deepEqual(plan.relationReviewIds,[]);
});

test('time correction updates both transaction time and consumption effective time',t=>{
 const x=setup(t),before=x.snapshot(),moved='2026-09-12T08:30:00Z';
 const plan=planTransactionCorrection({transactionId:'buy',replacement:replacement(10000,moved),expectedSnapshot:correctionSnapshot(before.entities,'buy'),correctedAt:'2026-10-02T00:00:00Z'},before);
 x.service.executeBatch(plan.commands);
 assert.equal(x.a.store.get('transactions','buy')?.fields.occurred_at,moved);
 assert.equal(x.a.store.get('consumption_effects','buy:effect')?.fields.effective_at,moved);
 assert.deepEqual(plan.relationReviewIds,[]);
});

test('type correction is allowed and invalidates only the relation that no longer makes sense',t=>{
 const x=setup(t),before=x.snapshot();
 const plan=planTransactionCorrection({transactionId:'buy',replacement:{kind:'INCOME',id:'buy',name:'Salary correction',amount:10000,destination:'bank',occurredAt:buyAt,note:'corrected type'},expectedSnapshot:correctionSnapshot(before.entities,'buy'),correctedAt:'2026-10-02T00:00:00Z'},before);
 assert.deepEqual(plan.relationReviewIds,['refund']);
 x.service.executeBatch(plan.commands);
 const row=x.a.store.get('transactions','buy');
 assert.equal(row?.fields.event_type,'INCOME');assert.equal(row?.fields.display_name,'Salary correction');assert.equal(row?.fields.note,'corrected type');
 assert.equal(x.snapshot().entities.some(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.from_transaction_id==='refund'),false);
});

test('manual transaction uses the same correction service as imported transactions',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute({kind:'CREATE_ACCOUNT',id:'bank',name:'bank',accountType:'ASSET',openingBalance:100000,openingBalanceAt:start});
 service.execute({kind:'PURCHASE',id:'manual',name:'Old',amount:5000,payer:'bank',occurredAt:buyAt,note:'before'});
 const before=project(p.a.store.allOperations());
 const plan=planTransactionCorrection({transactionId:'manual',replacement:{kind:'PURCHASE',id:'manual',name:'New',amount:5500,payer:'bank',occurredAt:buyAt,note:'after',categoryId:'购物'},expectedSnapshot:correctionSnapshot(before.entities,'manual'),correctedAt:'2026-10-02T00:00:00Z'},before);
 service.executeBatch(plan.commands);
 assert.equal(p.a.store.get('transactions','manual')?.fields.display_name,'New');assert.equal(p.a.store.get('transactions','manual')?.fields.note,'after');assert.equal(p.a.store.get('transactions','manual')?.fields.display_amount,5500);
});
