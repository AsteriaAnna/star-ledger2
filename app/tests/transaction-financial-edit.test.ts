import {pair,converge} from './helpers.ts';
import {project} from '../packages/sync/projection.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {BusinessAccountingService,pendingPostings,correctionSnapshot} from '../packages/accounting/business.ts';
import {transactionIntent} from '../packages/accounting/transaction-intent.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {planDetailEdit,transactionEditContext,detachedRefundReviews,type DetailFields} from '../packages/application/transaction-edit.ts';
import {planTransactionCorrection} from '../packages/application/correction-service.ts';
import {financialIssues} from '../packages/domain/invariants.ts';
import type {LedgerIntent,Purchase} from '../packages/domain/accounting.ts';
const at='2026-10-03T10:00:00Z';
function fixture(){
 const store=new MemoryStore(fresh()),service=new BusinessAccountingService(store,store.state.device);
 for(const [id,type] of [['bank','ASSET'],['wallet','ASSET'],['card','LIABILITY']] as const)service.execute({kind:'CREATE_ACCOUNT',id,name:id,accountType:type,openingBalance:0,openingBalanceAt:at});
 const snapshot=()=>({entities:store.entities,conflicts:store.conflicts});
 const create=(intent:LedgerIntent)=>service.execute(intent);
 const edit=(id:string,changedFields:Partial<DetailFields>)=>new AccountingService(store,store.state.device).execute(snap=>planDetailEdit({transactionId:id,changedFields,expectedSnapshot:transactionEditContext(snapshot(),id).expectedSnapshot},snap));
 const amount=(id:string,account:string)=>store.entities.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id===id&&e.fields.account_id===account).reduce((n,e)=>n+Number(e.fields.amount),0);
 return {store,service,snapshot,create,edit,amount};
}
const purchase=(id='p'):Purchase=>({kind:'PURCHASE',id,name:'消费',note:'原备注',amount:1000,payer:'bank',categoryId:'餐饮',occurredAt:at,source:{id:'source-'+id,sourceType:'EXCEL',platform:'微信',rawPayload:'immutable'}});
test('financial edit changes amount, liability account, date and metadata in one batch while keeping sources and valid refunds',()=>{
 const h=fixture();h.create(purchase());h.create({kind:'REFUND',id:'r',name:'退款',amount:300,destination:'bank',originalId:'p',occurredAt:'2026-10-03T12:00:00Z'});
 const source=structuredClone(h.store.entities.find(e=>e.type==='source_records'));
 h.edit('p',{amount:'20.00',account:'card',occurredAt:'2026-10-03T11:00:00Z',name:'改后消费',note:'新备注',category:'购物'});
 assert.equal(h.amount('p','bank'),0);assert.equal(h.amount('p','card'),2000);assert.equal(h.amount('r','bank'),300);
 assert.equal(h.store.entities.find(e=>e.id==='p:effect')?.fields.amount,2000);assert.equal(h.store.entities.find(e=>e.id==='r:effect')?.fields.category_id,'购物');
 assert.ok(h.store.entities.some(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.to_transaction_id==='p'));
 assert.deepEqual(h.store.entities.find(e=>e.type==='source_records'),source);assert.deepEqual(financialIssues(h.store.entities),[]);assert.ok(JSON.parse(String(h.store.entities.find(e=>e.id==='p')?.fields.user_edits)).fields.includes('account'));
});
test('changing original nature detaches invalid relations but preserves refund and a durable review question',()=>{
 const h=fixture();h.create(purchase());h.create({kind:'REFUND',id:'r',name:'退款',amount:300,destination:'bank',originalId:'p',occurredAt:'2026-10-03T12:00:00Z'});
 h.edit('p',{meaning:'INCOME'});assert.equal(h.amount('p','bank'),1000);assert.equal(h.amount('r','bank'),300);
 assert.equal(h.store.entities.find(e=>e.id==='r:effect')?.fields.amount,-300);
 const reopened=new MemoryStore(h.store.state);assert.deepEqual(detachedRefundReviews({entities:reopened.entities,conflicts:reopened.conflicts}),[{id:'r',name:'退款'}]);
});
test('all members of an over-refund set are detached rather than picking the first valid refund',()=>{
 const h=fixture();h.create(purchase());for(const id of ['r1','r2'])h.create({kind:'REFUND',id,name:id,amount:400,destination:'bank',originalId:'p',occurredAt:'2026-10-03T12:00:00Z'});
 h.edit('p',{amount:'5'});assert.equal(detachedRefundReviews(h.snapshot()).length,2);assert.equal(h.amount('r1','bank'),400);assert.equal(h.amount('r2','bank'),400);
});
test('split amounts must be explicit and sum exactly; switching back to one account is supported',()=>{
 const h=fixture();h.create(purchase());const before=structuredClone(h.store.state);
 assert.throws(()=>h.edit('p',{allocations:JSON.stringify([{accountId:'bank',amountText:'3'},{accountId:'wallet',amountText:'6'}])}),/ALLOCATION_SUM_MISMATCH/);assert.deepEqual(h.store.state,before);
 h.edit('p',{allocations:JSON.stringify([{accountId:'bank',amountText:'3'},{accountId:'wallet',amountText:'7'}])});assert.equal(h.amount('p','bank'),-300);assert.equal(h.amount('p','wallet'),-700);
 h.edit('p',{allocations:'[]',account:'card'});assert.equal(h.amount('p','card'),1000);assert.equal(h.amount('p','wallet'),0);
});
test('pending financial correction changes only the planned postings and settles once',()=>{
 const h=fixture();h.create({...purchase(),status:'PENDING'});h.edit('p',{amount:'15',account:'card',category:'生活'});
 assert.equal(h.store.entities.filter(e=>e.type==='balance_movements'||e.type==='consumption_effects').length,0);
 const tx=h.store.entities.find(e=>e.type==='transactions'&&e.id==='p')!;assert.equal(tx.fields.status,'PENDING');assert.equal(pendingPostings(tx).find(e=>e.type==='balance_movements')?.fields.amount,1500);
 h.service.execute({kind:'SET_STATUS',transactionId:'p',status:'SUCCESS',settlement:transactionIntent(h.snapshot(),'p')});assert.equal(h.amount('p','card'),1500);
});
test('repayment, withdrawal and internal transfer preserve direction, fees and valid current movements after repeated corrections',()=>{
 for(const kind of ['REPAYMENT','WITHDRAWAL','INTERNAL_TRANSFER'] as const){
  const h=fixture();const common={id:'t',name:kind,amount:1000,from:'bank',to:kind==='REPAYMENT'?'card':'wallet',occurredAt:at};
  h.create(kind==='WITHDRAWAL'?{...common,kind,fee:20}:{...common,kind});h.edit('t',{amount:'12'});h.edit('t',{amount:'14'});
  assert.equal(h.amount('t','bank'),kind==='WITHDRAWAL'?-1420:-1400);assert.equal(h.amount('t',common.to),kind==='REPAYMENT'?-1400:1400);
  assert.deepEqual(financialIssues(h.store.entities),[]);assert.equal(transactionIntent(h.snapshot(),'t').amount,1400);
 }
});
test('sponsored and unresolved purchases remain different after editing',()=>{
 const h=fixture();h.create({...purchase(),payer:null});h.edit('p',{amount:'11'});assert.ok(h.store.entities.some(e=>e.type==='balance_movements'&&e.fields.account_id===null&&e.fields.amount===-1100));
 h.edit('p',{funding:'EXTERNAL_SPONSOR',account:''});assert.equal(h.store.entities.filter(e=>e.type==='balance_movements'&&e.fields.amount!==0).length,0);assert.equal(h.store.entities.find(e=>e.id==='p:effect')?.fields.amount,1100);
});
test('unexpected relationship failures propagate and failed writes roll back the entire financial edit',()=>{
 const h=fixture();h.create(purchase());h.create({kind:'REFUND',id:'r',name:'退款',amount:300,destination:'wallet',originalId:'p',occurredAt:'2026-10-03T12:00:00Z'});
 const damaged=structuredClone(h.snapshot());damaged.entities.find(e=>e.type==='accounts'&&e.id==='wallet')!.fields.deleted_at=at;
 assert.throws(()=>planTransactionCorrection({transactionId:'p',replacement:{...purchase(),amount:2000},expectedSnapshot:correctionSnapshot(damaged.entities,'p'),correctedAt:at},damaged),/ACCOUNT_UNAVAILABLE/);
 const before=structuredClone(h.store.state),append=h.store.append.bind(h.store);let count=0;h.store.append=(op,local)=>{append(op,local);if(++count===3)throw Error('WRITE_FAILURE');};
 assert.throws(()=>h.edit('p',{amount:'20',account:'card'}),/WRITE_FAILURE/);assert.deepEqual(h.store.state,before);
});

test('edited field markers migrate and synchronize with their financial command',t=>{
 const h=pair(t),business=new BusinessAccountingService(h.a.store,'a');
 business.execute({...purchase(),payer:null});
 let snap=project(h.a.store.allOperations());const request={transactionId:'p',expectedSnapshot:transactionEditContext(snap,'p').expectedSnapshot,changedFields:{amount:'20',note:'用户备注'}};
 h.a.service.execute(current=>planDetailEdit(request,current));converge(h.a,h.b);
 const a=h.a.store.get('transactions','p')!,b=h.b.store.get('transactions','p')!;assert.equal(a.fields.display_amount,2000);assert.equal(b.fields.user_edits,a.fields.user_edits);assert.deepEqual(JSON.parse(String(b.fields.user_edits)).fields,['amount','note']);
 assert.equal(h.b.store.get('consumption_effects','p:effect')?.fields.amount,2000);
});

test('legacy failed and missing or damaged pending plans allow metadata without inventing financial facts',()=>{
 for(const [status,posting_plan] of [['FAILED',null],['PENDING',null],['PENDING','not-json']] as const){
  const h=fixture();h.create({...purchase(),status:'PENDING'});
  const snap=structuredClone(h.snapshot()),tx=snap.entities.find(e=>e.type==='transactions'&&e.id==='p')!;
  tx.fields.status=status;tx.fields.posting_plan=posting_plan;
  const before=structuredClone(snap),context=transactionEditContext(snap,'p');
  assert.equal(context.fields.amount,undefined);assert.equal(context.fields.category,null);
  const request={transactionId:'p',expectedSnapshot:context.expectedSnapshot,changedFields:{name:'保留旧账',note:'补充说明'}};
  const commands=planDetailEdit(request,snap);
  assert.ok(commands.length>0);assert.ok(commands.every(c=>c.entity.type==='transactions'&&Object.keys(c.entity.fields).every(k=>['display_name','note','user_edits'].includes(k))));
  assert.throws(()=>planDetailEdit({...request,changedFields:{amount:'20'}},snap),/EDIT_FINANCIAL_STRUCTURE_UNAVAILABLE|INVALID_POSTING_PLAN/);
  assert.deepEqual(snap,before);
 }
});
