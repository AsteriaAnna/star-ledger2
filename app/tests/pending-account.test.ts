import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessAccountingService,correctionSnapshot,pendingPostings} from '../packages/accounting/business.ts';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';

const at='2026-10-03T00:00:00Z';
function fixture(){
 const store=new MemoryStore(fresh()),service=new BusinessAccountingService(store,store.state.device);
 service.execute({kind:'CREATE_ACCOUNT',id:'card',name:'信用卡',accountType:'LIABILITY',openingBalance:0,openingBalanceAt:at});
 service.execute({kind:'CREATE_ACCOUNT',id:'bank',name:'储蓄卡',accountType:'ASSET',openingBalance:0,openingBalanceAt:at});
 const intent={kind:'PURCHASE' as const,id:'purchase',name:'待完成消费',amount:1000,occurredAt:at,payer:null};
 service.execute({...intent,status:'PENDING'});
 const answer=()=>({kind:'BIND_PENDING_ACCOUNT' as const,transactionId:intent.id,movementId:intent.id+':movement:0',accountId:'card',expectedSnapshot:correctionSnapshot(store.entities,intent.id)});
 return {store,service,intent,answer};
}

test('pending liability binding changes only plan, preserves debt sign, rejects stale edits',()=>{
 const {store,service,intent,answer}=fixture(),command=answer();service.execute(command);
 const tx=store.entities.find(e=>e.type==='transactions'&&e.id===intent.id)!;
 const planned=pendingPostings(tx).find(e=>e.type==='balance_movements')!;
 assert.equal(planned.fields.account_id,'card');assert.equal(planned.fields.amount,1000);
 assert.equal(store.entities.filter(e=>e.type==='balance_movements'||e.type==='consumption_effects').length,0);
 const before=structuredClone(store.state);
 assert.throws(()=>service.execute({...command,accountId:'bank'}),/STALE_TRANSACTION/);
 assert.throws(()=>service.execute({...answer(),accountId:'bank'}),/ACCOUNT_ALREADY_BOUND/);
 assert.deepEqual(store.state,before);
 service.execute({kind:'SET_STATUS',transactionId:intent.id,status:'SUCCESS',settlement:{...intent,payer:'card'}});
 const movements=store.entities.filter(e=>e.type==='balance_movements');assert.equal(movements.length,1);assert.equal(movements[0].fields.amount,1000);
 service.execute({kind:'SET_STATUS',transactionId:intent.id,status:'SUCCESS',settlement:{...intent,payer:'card'}});
 assert.equal(store.entities.filter(e=>e.type==='balance_movements').length,1);
});

test('failed pending purchase never materializes its bound future postings',()=>{
 const {store,service,intent,answer}=fixture();service.execute(answer());
 service.execute({kind:'SET_STATUS',transactionId:intent.id,status:'FAILED'});
 assert.equal(store.entities.filter(e=>e.type==='balance_movements'||e.type==='consumption_effects').length,0);
 assert.throws(()=>service.execute(answer()),/TRANSACTION_UNAVAILABLE/);
});
