import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveReturnAllocation} from '../packages/domain/return-allocation.ts';

test('fully consumed purchase automatically reduces consumption by refund amount',()=>{
 assert.deepEqual(resolveReturnAllocation({originalAmount:1000,originalConsumption:1000,previousReturned:0,previousReduction:0,amount:300}),{state:'RESOLVED',reduction:300});
});
test('non-consumption original automatically has zero consumption reduction',()=>{
 assert.deepEqual(resolveReturnAllocation({originalAmount:1000,originalConsumption:0,previousReturned:0,previousReduction:0,amount:300}),{state:'RESOLVED',reduction:0});
});
test('partial-consumption partial refund requires explicit allocation',()=>{
 assert.equal(resolveReturnAllocation({originalAmount:1000,originalConsumption:600,previousReturned:0,previousReduction:0,amount:300}).state,'NEEDS_ALLOCATION');
});
test('full refund of partially consumed original can infer total consumption reduction',()=>{
 assert.deepEqual(resolveReturnAllocation({originalAmount:1000,originalConsumption:600,previousReturned:0,previousReduction:0,amount:1000}),{state:'RESOLVED',reduction:600});
});
