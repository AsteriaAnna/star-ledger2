import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPeriod,previousPeriod,periodBounds,budgetForPeriod,consumptionChange,consumptionTrend,periodConsumption} from '../packages/analytics/period.ts';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
test('periods include the selected day in Beijing and compare calendar or equal-length ranges',()=>{
 assert.deepEqual(selectPeriod('WEEK','2026-10-04'),{start:'2026-09-28',end:'2026-10-04'});
 assert.deepEqual(selectPeriod('QUARTER','2026-01-01'),{start:'2025-11-01',end:'2026-01-31'});
 assert.deepEqual(previousPeriod({start:'2024-03-01',end:'2024-03-31'},'MONTH'),{start:'2024-02-01',end:'2024-02-29'});
 assert.deepEqual(previousPeriod({start:'2026-09-29',end:'2026-10-02'},'CUSTOM'),{start:'2026-09-25',end:'2026-09-28'});
 assert.deepEqual(periodBounds({start:'2026-10-01',end:'2026-10-01'}),['2026-09-30T16:00:00.000Z','2026-10-01T16:00:00.000Z']);
 assert.throws(()=>periodBounds({start:'2026-02-30',end:'2026-03-01'}),/INVALID_PERIOD/);
 assert.throws(()=>periodBounds({start:'2026-10-02',end:'2026-10-01'}),/INVALID_PERIOD/);
});
test('monthly budget uses calendar days, sums before rounding, preserves full-month exactness',()=>{
 assert.equal(budgetForPeriod(300000,{start:'2026-09-01',end:'2026-09-30'}),300000);
 assert.equal(budgetForPeriod(300000,{start:'2026-09-30',end:'2026-10-01'}),Math.round(300000/30+300000/31));
 assert.equal(budgetForPeriod(290000,{start:'2024-02-01',end:'2024-02-29'}),290000);
 assert.equal(budgetForPeriod(1,{start:'2026-01-01',end:'2026-12-31'}),12);
 assert.equal(budgetForPeriod(null,{start:'2026-01-01',end:'2026-12-31'}),null);
});
test('zero or negative previous totals do not create misleading growth percentages',()=>{
 assert.deepEqual(consumptionChange(100,0),{difference:100,percent:null});assert.equal(consumptionChange(100,-100).percent,null);assert.equal(consumptionChange(-100,100).percent,null);assert.equal(consumptionChange(120,100).percent,20);
});
test('range totals and trends follow transaction time, with refund and spending separate',()=>{
 const store=new MemoryStore(fresh()),svc=new BusinessAccountingService(store,store.state.device);
 svc.execute({kind:'PURCHASE',id:'p',name:'消费',amount:10000,payer:null,occurredAt:'2026-09-30T15:59:59Z'});svc.execute({kind:'REFUND',id:'r',name:'退款',amount:2500,originalId:'p',destination:null,occurredAt:'2026-09-30T16:00:00Z'});
 const ledger={entities:store.entities,conflicts:[]},period={start:'2026-10-01',end:'2026-10-01'};
 assert.deepEqual(periodConsumption(ledger,period),{spending:0,refunds:2500,net:-2500,count:0});assert.deepEqual(consumptionTrend(ledger,period),[{key:'2026-10-01',amount:-2500}]);
 const both=periodConsumption(ledger,{start:'2026-09-30',end:'2026-10-01'});assert.deepEqual(both,{spending:10000,refunds:2500,net:7500,count:1});
});
