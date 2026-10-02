import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessAccountingService,correctionSnapshot} from '../packages/accounting/business.ts';
import {planTransactionCorrection} from '../packages/application/correction-service.ts';
import {accountBalance,accountLedger,consumptionInPeriod,reconcileAccount} from '../packages/analytics/index.ts';
import {project} from '../packages/sync/projection.ts';
import {pair} from './helpers.ts';

const opening='2026-09-01T00:00:00Z',purchaseAt='2026-09-10T10:00:00Z',anchorAt='2026-09-15T12:00:00Z',later='2026-09-20T10:00:00Z',end='2026-10-01T00:00:00Z';
function setup(t:Parameters<typeof pair>[0]){
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute({kind:'CREATE_ACCOUNT',id:'bank',name:'bank',accountType:'ASSET',openingBalance:100000,openingBalanceAt:opening});
 service.execute({kind:'PURCHASE',id:'buy',name:'purchase',amount:10000,payer:'bank',occurredAt:purchaseAt,categoryId:'餐饮'});
 const snapshot=()=>project(p.a.store.allOperations());
 return {...p,service,snapshot};
}

test('reconciliation observation reports difference without changing the ledger',t=>{
 const x=setup(t),before=x.a.store.allOperations().length;
 const result=reconcileAccount(x.snapshot(),'bank',89500,anchorAt);
 assert.equal(result.ledgerBalance,90000);assert.equal(result.difference,-500);assert.equal(x.a.store.allOperations().length,before);
});

test('balance anchor resets only balance derivation, never consumption',t=>{
 const x=setup(t);
 x.service.execute({kind:'SET_BALANCE_ANCHOR',id:'anchor-1',accountId:'bank',observedBalance:89500,observedAt:anchorAt,sourceType:'MANUAL',createdAt:anchorAt});
 assert.equal(accountBalance(x.snapshot(),'bank',anchorAt).balance,89500);
 assert.equal(consumptionInPeriod(x.snapshot(),opening,end),10000);
 x.service.execute({kind:'INCOME',id:'income',name:'income',amount:2000,destination:'bank',occurredAt:later});
 assert.equal(accountBalance(x.snapshot(),'bank',end).balance,91500);
});

test('account ledger starts at latest trusted anchor and exposes running balance',t=>{
 const x=setup(t);
 x.service.execute({kind:'SET_BALANCE_ANCHOR',id:'anchor-1',accountId:'bank',observedBalance:90000,observedAt:anchorAt,sourceType:'STATEMENT',createdAt:anchorAt});
 x.service.execute({kind:'PURCHASE',id:'later-buy',name:'later',amount:2500,payer:'bank',occurredAt:later});
 const ledger=accountLedger(x.snapshot(),'bank',end);
 assert.equal(ledger.baseline.source,'ANCHOR');assert.equal(ledger.baseline.anchorId,'anchor-1');assert.equal(ledger.rows.length,1);
 assert.deepEqual(ledger.rows[0],{transactionId:'later-buy',movementId:'later-buy:movement:0',occurredAt:later,amount:-2500,runningBalance:87500,displayName:'later'});
 assert.equal(ledger.balance,87500);
});

test('moving a transaction across an anchor boundary changes balance transparently',t=>{
 const x=setup(t);
 x.service.execute({kind:'SET_BALANCE_ANCHOR',id:'anchor-1',accountId:'bank',observedBalance:90000,observedAt:anchorAt,sourceType:'MANUAL',createdAt:anchorAt});
 const before=x.snapshot();assert.equal(accountBalance(before,'bank',end).balance,90000);
 const plan=planTransactionCorrection({transactionId:'buy',replacement:{kind:'PURCHASE',id:'buy',name:'purchase',amount:10000,payer:'bank',occurredAt:later,categoryId:'餐饮'},expectedSnapshot:correctionSnapshot(before.entities,'buy'),correctedAt:'2026-10-02T00:00:00Z'},before);
 x.service.executeBatch(plan.commands);
 assert.equal(accountBalance(x.snapshot(),'bank',end).balance,80000);
 const ledger=accountLedger(x.snapshot(),'bank',end);assert.equal(ledger.rows.length,1);assert.equal(ledger.rows[0].transactionId,'buy');
});

test('same-time contradictory anchors fail closed instead of selecting a silent winner',t=>{
 const x=setup(t);
 x.service.execute({kind:'SET_BALANCE_ANCHOR',id:'anchor-a',accountId:'bank',observedBalance:90000,observedAt:anchorAt,sourceType:'MANUAL',createdAt:anchorAt});
 x.service.execute({kind:'SET_BALANCE_ANCHOR',id:'anchor-b',accountId:'bank',observedBalance:91000,observedAt:anchorAt,sourceType:'STATEMENT',createdAt:'2026-09-16T00:00:00Z'});
 assert.throws(()=>accountBalance(x.snapshot(),'bank',end),/AMBIGUOUS_BALANCE_ANCHOR/);
});

test('an anchor can establish an account whose initial balance was unknown',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute({kind:'CREATE_ACCOUNT',id:'unknown',name:'unknown',accountType:'ASSET',openingBalance:null,openingBalanceAt:opening});
 let snap=project(p.a.store.allOperations());assert.equal(accountBalance(snap,'unknown',anchorAt).state,'UNINITIALIZED');
 service.execute({kind:'SET_BALANCE_ANCHOR',id:'known-now',accountId:'unknown',observedBalance:43210,observedAt:anchorAt,sourceType:'MANUAL',createdAt:anchorAt});
 snap=project(p.a.store.allOperations());assert.equal(accountBalance(snap,'unknown',end).balance,43210);
});
