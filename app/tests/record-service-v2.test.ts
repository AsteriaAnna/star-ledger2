import test from 'node:test';
import assert from 'node:assert/strict';
import {buildManualLedgerIntent} from '../packages/application/record-service.ts';
import {interpret} from '../packages/accounting/business.ts';
import type {Entity} from '../packages/domain/index.ts';

const now='2026-10-02T12:00:00Z';
const account=(id:string,type='ASSET'):Entity=>({type:'accounts',id,fields:{name:id,type,balance_tracking:'ENABLED',balance_state:'ESTABLISHED',opening_balance:0,opening_balance_at:'2026-01-01T00:00:00Z',last4:'',deleted_at:null}});
const ledger={entities:[account('bank'),account('wallet'),account('credit','LIABILITY')],conflicts:[]};

test('manual spend with unknown payer stays owned-but-unresolved, never becomes sponsored',()=>{
 const intent=buildManualLedgerIntent({action:'SPEND',transactionId:'x',amount:2500,payer:null,categoryId:'餐饮'},now);
 assert.equal(intent.kind,'PURCHASE');if(intent.kind!=='PURCHASE')return;
 assert.equal(intent.funding,'OWN');assert.equal(intent.payer,null);assert.equal(intent.occurredAt,now);assert.equal(intent.name,'消费');
 const commands=interpret(intent,ledger);assert.equal(commands.find(x=>x.entity.type==='balance_movements')?.entity.fields.account_id,null);assert.equal(commands.find(x=>x.entity.type==='consumption_effects')?.entity.fields.amount,2500);
});

test('sponsored spend is explicit consumption without own balance movement',()=>{
 const intent=buildManualLedgerIntent({action:'SPEND',transactionId:'x',amount:2500,payer:null,funding:'EXTERNAL_SPONSOR',categoryId:'餐饮'},now);
 const commands=interpret(intent,ledger);assert.equal(commands.some(x=>x.entity.type==='balance_movements'),false);assert.equal(commands.find(x=>x.entity.type==='consumption_effects')?.entity.fields.amount,2500);
});

test('receive defaults to income but refund remains a distinct relation-capable meaning',()=>{
 const income=buildManualLedgerIntent({action:'RECEIVE',transactionId:'income',amount:5000,destination:'bank'},now);assert.equal(income.kind,'INCOME');
 const refund=buildManualLedgerIntent({action:'RECEIVE',meaning:'REFUND',transactionId:'refund',amount:1000,destination:'bank',originalId:null},now);
 assert.equal(refund.kind,'REFUND');if(refund.kind==='REFUND'){assert.equal(refund.originalId,null);assert.equal(refund.name,'退款');}
});

test('transfer entry never assumes all transfers are consumption',()=>{
 const own=buildManualLedgerIntent({action:'TRANSFER',meaning:'BETWEEN_OWN',transactionId:'own',amount:3000,from:'bank',to:'wallet'},now);assert.equal(own.kind,'INTERNAL_TRANSFER');
 const external=buildManualLedgerIntent({action:'TRANSFER',meaning:'TO_OTHER',transactionId:'other',amount:3000,from:'bank'},now);
 assert.equal(external.kind,'EXTERNAL_TRANSFER');if(external.kind==='EXTERNAL_TRANSFER')assert.equal(external.consumptionAmount,0);
 const repayment=buildManualLedgerIntent({action:'TRANSFER',meaning:'REPAYMENT',transactionId:'repay',amount:3000,from:'bank',to:'credit'},now);assert.equal(repayment.kind,'REPAYMENT');
 const withdrawal=buildManualLedgerIntent({action:'TRANSFER',meaning:'WITHDRAWAL',transactionId:'cash',amount:3000,from:'bank',to:'wallet'},now);assert.equal(withdrawal.kind,'WITHDRAWAL');
});

test('manual record rejects contradictory sponsor/account input before domain commit',()=>{
 assert.throws(()=>buildManualLedgerIntent({action:'SPEND',transactionId:'x',amount:1000,payer:'bank',funding:'EXTERNAL_SPONSOR'},now),/SPONSOR_HAS_OWN_ACCOUNT/);
 assert.throws(()=>buildManualLedgerIntent({action:'RECEIVE',meaning:'REFUND',transactionId:'r',amount:1000,destination:'bank',funding:'EXTERNAL_SPONSOR'},now),/SPONSORED_REFUND_HAS_OWN_ACCOUNT/);
});


test('manual spend can pass through explicit split funding without inventing a primary payer',()=>{
 const intent=buildManualLedgerIntent({action:'SPEND',transactionId:'split',amount:10000,payer:null,payerAllocations:[{accountId:'bank',amount:7000},{accountId:'wallet',amount:3000}],categoryId:'餐饮'},now);
 assert.equal(intent.kind,'PURCHASE');if(intent.kind!=='PURCHASE')return;
 assert.equal(intent.payer,null);assert.deepEqual(intent.payerAllocations,[{accountId:'bank',amount:7000},{accountId:'wallet',amount:3000}]);
 const commands=interpret(intent,ledger),moves=commands.filter(x=>x.entity.type==='balance_movements');
 assert.deepEqual(moves.map(x=>[x.entity.fields.account_id,x.entity.fields.amount]),[['bank',-7000],['wallet',-3000]]);
});
