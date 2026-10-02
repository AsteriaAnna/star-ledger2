import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {consumptionByCategory,consumptionByDay,consumptionContributions,consumptionInPeriod} from '../packages/analytics/index.ts';
import {project} from '../packages/sync/projection.ts';
import {pair} from './helpers.ts';

const start='2026-09-01T00:00:00Z',end='2026-10-01T00:00:00Z';
test('analysis total category day and drilldown IDs share one contribution basis',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute({kind:'CREATE_ACCOUNT',id:'bank',name:'bank',accountType:'ASSET',openingBalance:100000,openingBalanceAt:start});
 service.execute({kind:'PURCHASE',id:'food',name:'Lunch',amount:10000,payer:'bank',occurredAt:'2026-09-05T10:00:00Z',categoryId:'餐饮'});
 service.execute({kind:'PURCHASE',id:'shop',name:'Shop',amount:5000,payer:'bank',occurredAt:'2026-09-06T10:00:00Z',categoryId:'购物'});
 service.execute({kind:'REFUND',id:'refund',name:'Lunch refund',amount:3000,originalId:'food',destination:'bank',occurredAt:'2026-09-20T10:00:00Z'});
 const snap=project(p.a.store.allOperations()),rows=consumptionContributions(snap,start,end),categories=consumptionByCategory(snap,start,end),days=consumptionByDay(snap,start,end);
 assert.equal(consumptionInPeriod(snap,start,end),12000);
 assert.equal(rows.reduce((sum,row)=>sum+row.amount,0),12000);
 assert.deepEqual(categories.find(x=>x.key==='餐饮'),{key:'餐饮',amount:7000,transactionIds:['food','refund']});
 assert.deepEqual(categories.find(x=>x.key==='购物'),{key:'购物',amount:5000,transactionIds:['shop']});
 assert.deepEqual(days.find(x=>x.key==='2026-09-20'),{key:'2026-09-20',amount:-3000,transactionIds:['refund']});
 assert.equal(categories.reduce((sum,row)=>sum+row.amount,0),12000);assert.equal(days.reduce((sum,row)=>sum+row.amount,0),12000);
});

test('analysis excludes failed and deleted transactions through the same basis',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute({kind:'CREATE_ACCOUNT',id:'bank',name:'bank',accountType:'ASSET',openingBalance:100000,openingBalanceAt:start});
 service.execute({kind:'PURCHASE',id:'failed',name:'Failed',amount:1000,payer:'bank',occurredAt:'2026-09-05T10:00:00Z',categoryId:'餐饮',status:'FAILED'});
 service.execute({kind:'PURCHASE',id:'deleted',name:'Deleted',amount:2000,payer:'bank',occurredAt:'2026-09-06T10:00:00Z',categoryId:'餐饮'});
 service.execute({kind:'DELETE_TRANSACTION',transactionId:'deleted',deletedAt:'2026-09-07T00:00:00Z'});
 const snap=project(p.a.store.allOperations());
 assert.deepEqual(consumptionContributions(snap,start,end),[]);assert.equal(consumptionInPeriod(snap,start,end),0);assert.deepEqual(consumptionByCategory(snap,start,end),[]);
});
