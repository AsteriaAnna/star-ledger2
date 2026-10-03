import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {BusinessAccountingService,pendingPostings} from '../packages/accounting/business.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import {resolveLegacyImportBatch} from '../apps/web/src/import-v2-flow.ts';
import {parseRows,csv} from '../apps/web/src/importer.ts';
import {planImportExecution,importRecordOutcomes,completeImportSessionFromOutcomes} from '../packages/application/import-execution.ts';
import {planImportAccountAnswer} from '../packages/application/import-account-attention.ts';
import {readAccountMapping} from '../packages/importing/resolution-memory.ts';

const now='2026-10-02T12:00:00Z';
const text='微信支付账单明细\n交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号\n'+
 '2026-09-20 12:00:00,商户消费,咖啡店,咖啡,支出,20,零钱,支付成功,w1\n'+
 '2026-09-20 13:00:00,商户消费,书店,书,支出,30,零钱,支付成功,w2\n';
async function fixture(pending=false){
 const store=new MemoryStore(fresh()),workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace);
 const drafts=parseRows(csv(text));if(pending)for(const draft of drafts)draft.status='PENDING';
 const resolved=await resolveLegacyImportBatch({drafts,sessionId:'s',ledger:{entities:[],conflicts:[]},now,service});
 const execution=planImportExecution(resolved.plan,{entities:[],conflicts:[]},now);
 new BusinessAccountingService(store,store.state.device).executeBatch(execution.commands);
 const outcomes=importRecordOutcomes('s',execution,now),attention=await workspace.listAttentionItems('s');
 store.state.importWorkspace={sessions:{s:completeImportSessionFromOutcomes(resolved.result.session,outcomes,attention,now)},records:{s:resolved.records},attention:{s:attention},outcomes:{s:outcomes}};
 return store;
}
const apply=(store:MemoryStore)=>{
 const plan=planImportAccountAnswer({sessionId:'s',attentionId:store.state.importWorkspace!.attention.s[0].id,accountId:'wallet',createAccount:{kind:'CREATE_ACCOUNT',id:'wallet',name:'日常零钱',accountType:'ASSET',openingBalance:null,openingBalanceAt:now},now},store.state.importWorkspace!,{entities:store.entities,conflicts:store.conflicts});
 new AccountingService(store,store.state.device).execute(plan.commands);store.state.importWorkspace=plan.workspace;return plan;
};
test('one answer creates an account, binds all same-channel rows, preserves evidence and consumption, and remembers future imports',async()=>{
 const store=await fixture(),sources=structuredClone(store.entities.filter(e=>e.type==='source_records')),effects=structuredClone(store.entities.filter(e=>e.type==='consumption_effects'));
 const plan=apply(store);assert.equal(plan.resolvedCount,2);
 assert.deepEqual(store.entities.filter(e=>e.type==='source_records'),sources);assert.deepEqual(store.entities.filter(e=>e.type==='consumption_effects'),effects);
 assert.ok(store.entities.filter(e=>e.type==='balance_movements').every(e=>e.fields.account_id==='wallet'));
 assert.equal(store.state.importWorkspace!.attention.s.length,0);assert.equal(store.state.importWorkspace!.sessions.s.committedCount,2);
 const memory={findAccountMapping:async(key:any)=>readAccountMapping(store.entities,key),rememberAccountMapping:async()=>{},findMerchantCategory:async()=>null,rememberMerchantCategory:async()=>{}};
 const service=new ImportStatementService(new InMemoryImportWorkspace(),memory);
 const next=await resolveLegacyImportBatch({drafts:parseRows(csv(text.replaceAll('w1','w3').replaceAll('w2','w4'))),sessionId:'next',ledger:{entities:store.entities,conflicts:[]},now,service});
 assert.equal(next.result.records.flatMap(r=>r.attention).length,0);assert.ok(next.plan.newRecords.every(r=>r.intent.kind==='PURCHASE'&&r.intent.payer==='wallet'));
});
test('stale binding fails atomically without leaving a new account or clearing questions',async()=>{
 const store=await fixture();new BusinessAccountingService(store,store.state.device).execute({kind:'CREATE_ACCOUNT',id:'other',name:'另一个账户',accountType:'ASSET',openingBalance:null,openingBalanceAt:now});
 const movement=store.entities.find(e=>e.type==='balance_movements')!;
 new BusinessAccountingService(store,store.state.device).execute({kind:'BIND_ACCOUNT',movementId:movement.id,accountId:'other'});
 const before=structuredClone(store.state);
 assert.throws(()=>apply(store),/ACCOUNT_ALREADY_BOUND/);assert.deepEqual(store.state,before);
});
test('a replayed account answer is rejected without duplicate postings',async()=>{
 const store=await fixture(),attentionId=store.state.importWorkspace!.attention.s[0].id;apply(store);const n=store.state.ops.length;
 assert.throws(()=>planImportAccountAnswer({sessionId:'s',attentionId,accountId:'wallet',now},store.state.importWorkspace!,{entities:store.entities,conflicts:[]}),/STALE_IMPORT_ATTENTION/);assert.equal(store.state.ops.length,n);
});

test('pending account answers bind only future postings and create no current balance or consumption',async()=>{
 const store=await fixture(true),sources=structuredClone(store.entities.filter(e=>e.type==='source_records'));
 const plan=apply(store);assert.equal(plan.resolvedCount,2);
 assert.equal(store.entities.filter(e=>['balance_movements','consumption_effects'].includes(e.type)).length,0);
 for(const tx of store.entities.filter(e=>e.type==='transactions')){
  assert.equal(tx.fields.status,'PENDING');
  assert.ok(pendingPostings(tx).filter(e=>e.type==='balance_movements').every(e=>e.fields.account_id==='wallet'));
 }
 assert.deepEqual(store.entities.filter(e=>e.type==='source_records'),sources);
 assert.equal(store.state.importWorkspace!.attention.s.length,0);
 const tx=store.entities.find(e=>e.type==='transactions')!;
 const settlement={kind:'PURCHASE' as const,id:tx.id,name:String(tx.fields.display_name),amount:Number(tx.fields.display_amount),occurredAt:String(tx.fields.occurred_at),payer:'wallet'};
 new BusinessAccountingService(store,store.state.device).execute({kind:'SET_STATUS',transactionId:tx.id,status:'SUCCESS',settlement});
 assert.equal(store.entities.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id===tx.id).length,1);
 assert.equal(store.entities.find(e=>e.type==='balance_movements'&&e.fields.transaction_id===tx.id)?.fields.account_id,'wallet');
});
