import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {pair} from './helpers.ts';

const at='2026-10-02T10:00:00Z';
test('repayment can post with unresolved endpoints and later bind with role invariants',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute({kind:'CREATE_ACCOUNT',id:'bank',name:'bank',accountType:'ASSET',openingBalance:100000,openingBalanceAt:'2026-01-01T00:00:00Z'});
 service.execute({kind:'CREATE_ACCOUNT',id:'credit',name:'credit',accountType:'LIABILITY',openingBalance:50000,openingBalanceAt:'2026-01-01T00:00:00Z'});
 service.execute({kind:'REPAYMENT',id:'repay',name:'repay',amount:10000,from:null,to:null,occurredAt:at});
 assert.equal(p.a.store.get('balance_movements','repay:movement:0')?.fields.amount,-10000);
 assert.equal(p.a.store.get('balance_movements','repay:movement:1')?.fields.amount,10000);
 assert.throws(()=>service.execute({kind:'BIND_ACCOUNT',movementId:'repay:movement:0',accountId:'credit'}),/REPAYMENT_SOURCE_REQUIRES_ASSET/);
 assert.throws(()=>service.execute({kind:'BIND_ACCOUNT',movementId:'repay:movement:1',accountId:'bank'}),/REPAYMENT_TARGET_REQUIRES_LIABILITY/);
 service.execute({kind:'BIND_ACCOUNT',movementId:'repay:movement:0',accountId:'bank'});
 service.execute({kind:'BIND_ACCOUNT',movementId:'repay:movement:1',accountId:'credit'});
 assert.equal(p.a.store.get('balance_movements','repay:movement:0')?.fields.amount,-10000);
 assert.equal(p.a.store.get('balance_movements','repay:movement:1')?.fields.amount,-10000);
});
