import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {BusinessAccountingService,pendingPostings} from '../packages/accounting/business.ts';
import {planImportTransferAnswer,transferAttentionContext,type ImportTransferAnswer} from '../packages/application/import-transfer-attention.ts';
import type {ImportWorkspaceSnapshot} from '../packages/importing/workspace.ts';

const at='2026-10-03T11:00:00Z';
function fixture(kind:'REPAYMENT'|'INTERNAL_TRANSFER'|'WITHDRAWAL'='REPAYMENT',pending=false){
 const store=new MemoryStore(fresh()),service=new BusinessAccountingService(store,store.state.device);
 for(const [id,type] of [['bank','ASSET'],['destination','ASSET'],['card','LIABILITY']] as const)service.execute({kind:'CREATE_ACCOUNT',id,name:id,accountType:type,openingBalance:0,openingBalanceAt:at});
 const source={id:'evidence',sourceType:'EXCEL' as const,platform:'支付宝',rawPayload:'immutable',capturedAt:at};
 const intent={id:'tx',name:'转账',amount:1000,occurredAt:at,from:'bank',to:null,status:pending?'PENDING' as const:'SUCCESS' as const,source};
 service.execute(kind==='WITHDRAWAL'?{...intent,kind,fee:20}:{...intent,kind});
 const workspace:ImportWorkspaceSnapshot={sessions:{s:{id:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',createdAt:at,updatedAt:at,state:'COMPLETED',sourceCount:1,committedCount:1,skippedDuplicateCount:0,noEffectCount:0,blockingAttentionCount:0,nonBlockingAttentionCount:1,failureCode:null}},records:{s:[]},attention:{s:[{id:'question',sessionId:'s',externalRecordId:'row',kind:'TRANSFER_ENDPOINTS',question:'转入哪个账户',blocking:false,candidates:[],createdAt:at}]},outcomes:{s:[{sessionId:'s',externalRecordId:'row',state:'COMMITTED',transactionId:'tx',updatedAt:at}]}};
 store.state.importWorkspace=workspace;
 const snapshot=()=>({entities:store.entities,conflicts:store.conflicts});
 const request=(accountId:string)=>({sessionId:'s',attentionId:'question',accountId,expectedSnapshot:transferAttentionContext('s','question',store.state.importWorkspace!,snapshot()).expectedSnapshot,now:at});
 const answer=(input:ImportTransferAnswer)=>{const plan=planImportTransferAnswer(input,store.state.importWorkspace!,snapshot());new AccountingService(store,store.state.device).execute(plan.commands);store.state.importWorkspace=plan.workspace;return plan;};
 return {store,service,snapshot,request,answer};
}

test('repayment destination binds debt with the correct sign and preserves consumption, evidence and transaction count',()=>{
 const h=fixture(),before=structuredClone(h.store.entities.filter(e=>['source_records','consumption_effects'].includes(e.type)));
 h.answer(h.request('card'));
 assert.equal(h.store.entities.filter(e=>e.type==='transactions').length,1);
 assert.equal(h.store.entities.find(e=>e.type==='balance_movements'&&e.fields.account_id==='card')?.fields.amount,-1000);
 assert.equal(h.store.entities.find(e=>e.type==='balance_movements'&&e.fields.account_id==='bank')?.fields.amount,-1000);
 assert.deepEqual(h.store.entities.filter(e=>['source_records','consumption_effects'].includes(e.type)),before);
 assert.equal(h.store.state.importWorkspace!.attention.s.length,0);
});

test('withdrawal and internal transfer reject same account or liability targets and retain fee consumption',()=>{
 for(const kind of ['WITHDRAWAL','INTERNAL_TRANSFER'] as const){
  const h=fixture(kind),before=structuredClone(h.store.state);
  assert.throws(()=>h.answer(h.request('bank')),/SAME_ACCOUNT_TRANSFER/);
  assert.throws(()=>h.answer(h.request('card')),/ACCOUNT_UNAVAILABLE/);assert.deepEqual(h.store.state,before);
  h.answer(h.request('destination'));assert.equal(h.store.entities.find(e=>e.type==='balance_movements'&&e.fields.account_id==='destination')?.fields.amount,1000);
  assert.equal(h.store.entities.find(e=>e.type==='consumption_effects')?.fields.amount,kind==='WITHDRAWAL'?20:undefined);
 }
});

test('pending target answer updates only future postings',()=>{
 const h=fixture('REPAYMENT',true);h.answer(h.request('card'));
 assert.equal(h.store.entities.filter(e=>e.type==='balance_movements'||e.type==='consumption_effects').length,0);
 const postings=pendingPostings(h.store.entities.find(e=>e.type==='transactions')!);
 assert.equal(postings.find(e=>e.type==='balance_movements'&&e.fields.account_id==='card')?.fields.amount,-1000);
});

test('stale destination answer cannot create an account or clear its question',()=>{
 const h=fixture(),input={...h.request('new-card'),createAccount:{kind:'CREATE_ACCOUNT' as const,id:'new-card',name:'新卡',accountType:'LIABILITY' as const,openingBalance:null,openingBalanceAt:at}};
 h.service.execute({kind:'BIND_ACCOUNT',movementId:'tx:movement:1',accountId:'card'});const before=structuredClone(h.store.state);
 assert.throws(()=>h.answer(input),/STALE_TRANSACTION/);assert.deepEqual(h.store.state,before);
});

test('account creation and destination binding roll back together on failed writes',()=>{
 const h=fixture(),before=structuredClone(h.store.state),append=h.store.append.bind(h.store);let count=0;
 h.store.append=(op,local)=>{append(op,local);if(++count===2)throw Error('INJECTED_FAILURE');};
 assert.throws(()=>h.answer({...h.request('new-card'),createAccount:{kind:'CREATE_ACCOUNT',id:'new-card',name:'新卡',accountType:'LIABILITY',openingBalance:null,openingBalanceAt:at}}),/INJECTED_FAILURE/);
 assert.deepEqual(h.store.state,before);
});
