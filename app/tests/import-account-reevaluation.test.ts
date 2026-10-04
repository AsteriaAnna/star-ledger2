import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import {resolveLegacyImportBatch} from '../apps/web/src/import-v2-flow.ts';
import {planImportExecution,importRecordOutcomes,completeImportSessionFromOutcomes} from '../packages/application/import-execution.ts';
import {planImportAccountAnswer} from '../packages/application/import-account-attention.ts';
import {planImportTransferAnswer,transferAttentionContext} from '../packages/application/import-transfer-attention.ts';
import {resolveLedgerAccount} from '../packages/importing/account-resolution.ts';
import {rememberAccountMappingCommand,accountMappingKey} from '../packages/importing/resolution-memory.ts';
import type {Draft} from '../apps/web/src/importer.ts';
const now='2026-10-05T00:00:00Z';
const draft=(id:string,overrides:Partial<Draft>={}):Draft=>({key:id,identity:id,itemId:id,platform:'微信',profile:'本人',name:'测试消费',amount:'30',date:'2026-09-01T12:00:00',kind:'PURCHASE',status:'SUCCESS',channel:'零钱',account:'',to:'',category:'餐饮',original:'',note:'',raw:'{}',issue:'',selected:false,sourceType:'EXCEL',order:id,sponsor:false,consumption:'0',blockers:[],...overrides});
async function receive(store:MemoryStore,id:string,drafts:Draft[]){
 const workspace=new InMemoryImportWorkspace(store.state.importWorkspace),service=new ImportStatementService(workspace),ledger={entities:store.entities,conflicts:store.conflicts};
 const resolved=await resolveLegacyImportBatch({drafts,sessionId:id,ledger,now,service}),execution=planImportExecution(resolved.plan,ledger,now);
 new BusinessAccountingService(store,store.state.device).executeBatch(execution.commands);
 const next=workspace.snapshot(),outcomes=importRecordOutcomes(id,execution,now);next.outcomes[id]=outcomes;next.sessions[id]=completeImportSessionFromOutcomes(resolved.result.session,outcomes,next.attention[id],now);store.state.importWorkspace=next;return resolved;
}
function answer(store:MemoryStore,sessionId:string,accountId:string,name:string,remember=true){
 const attention=store.state.importWorkspace!.attention[sessionId].find(a=>a.kind==='ACCOUNT')!;
 const plan=planImportAccountAnswer({sessionId,attentionId:attention.id,accountId,createAccount:{kind:'CREATE_ACCOUNT',id:accountId,name,accountType:'ASSET',openingBalance:null,openingBalanceAt:now,last4:accountId==='bank'?'2372':''},remember,now},store.state.importWorkspace!,{entities:store.entities,conflicts:store.conflicts});
 new AccountingService(store,store.state.device).execute(plan.commands);store.state.importWorkspace=plan.workspace;return plan;
}
test('one remembered answer fills previous and current batches; imported consumption/evidence remain unchanged',async()=>{
 const store=new MemoryStore(fresh());await receive(store,'old',[draft('old')]);await receive(store,'new',[draft('new')]);
 const facts=structuredClone(store.entities.filter(e=>['source_records','consumption_effects'].includes(e.type)));
 const plan=answer(store,'new','wallet','日常零钱');assert.equal(plan.resolvedCount,2);assert.equal(store.state.importWorkspace!.attention.old.length,0);assert.equal(store.state.importWorkspace!.attention.new.length,0);
 assert.ok(store.entities.filter(e=>e.type==='balance_movements').every(e=>e.fields.account_id==='wallet'));assert.deepEqual(store.entities.filter(e=>['source_records','consumption_effects'].includes(e.type)),facts);
});
test('renamed card identity is shared across sources, while one-off choice stays in its batch',async()=>{
 for(const remember of [true,false]){
 const store=new MemoryStore(fresh());await receive(store,'ali',[draft('ali',{platform:'支付宝',channel:'中国农业银行储蓄卡(2372)'})]);await receive(store,'wx',[draft('wx',{channel:'农业银行储蓄卡(2372)'})]);
 answer(store,'wx','bank','工资卡',remember);assert.equal(store.state.importWorkspace!.attention.ali.length,remember?0:1);
 const next=await receive(store,'next',[draft('next',{platform:'支付宝',channel:'农业银行储蓄卡(2372)'})]);assert.equal(next.result.records[0].account?.accountId,remember?'bank':null);
 }
});
test('one Huabei target choice fills all repayments and the future destination without another consumption',async()=>{
 const store=new MemoryStore(fresh());for(const id of ['first','second'])await receive(store,id,[draft(id,{platform:'支付宝',name:'花呗还款',kind:'REPAYMENT',channel:'农业银行储蓄卡(2372)'})]);
 const w=store.state.importWorkspace!,attention=w.attention.second.find(a=>a.kind==='TRANSFER_ENDPOINTS')!,ledger={entities:store.entities,conflicts:store.conflicts},context=transferAttentionContext('second',attention.id,w,ledger);
 const plan=planImportTransferAnswer({sessionId:'second',attentionId:attention.id,accountId:'credit',expectedSnapshot:context.expectedSnapshot,now,createAccount:{kind:'CREATE_ACCOUNT',id:'credit',name:'我的信用额度',accountType:'LIABILITY',openingBalance:null,openingBalanceAt:now}},w,ledger);
 new AccountingService(store,store.state.device).execute(plan.commands);store.state.importWorkspace=plan.workspace;
 assert.ok(Object.values(plan.workspace.attention).flat().every(a=>a.kind!=='TRANSFER_ENDPOINTS'));
 assert.equal(store.entities.filter(e=>e.type==='balance_movements'&&e.fields.account_id==='credit').length,2);
 assert.equal(store.entities.filter(e=>e.type==='consumption_effects').reduce((n,e)=>n+Number(e.fields.amount),0),0);
 const future=await receive(store,'third',[draft('third',{platform:'支付宝',name:'花呗还款',kind:'REPAYMENT',channel:'农业银行储蓄卡(2372)'})]);assert.equal(future.result.records[0].targetAccount?.accountId,'credit');
});
test('forgotten, conflicted, or another-profile aliases cannot silently identify a renamed card',()=>{
 const store=new MemoryStore(fresh());new BusinessAccountingService(store,store.state.device).execute({kind:'CREATE_ACCOUNT',id:'bank',name:'工资卡',accountType:'ASSET',openingBalance:null,openingBalanceAt:now,last4:'2372'});
 const key={sourceSystem:'WECHAT',profile:'本人',channelKey:'农业银行:debit:2372',role:'PRIMARY'},request={eventKind:'PURCHASE',sourceSystem:'ALIPAY',platform:'支付宝',profile:'本人',channelRaw:'农业银行储蓄卡(2372)',role:'ACCOUNT' as const,sponsored:false};
 new AccountingService(store,store.state.device).execute([rememberAccountMappingCommand(store.entities,key,{accountId:'bank',rememberedAt:now})]);assert.equal(resolveLedgerAccount(request,store.entities).accountId,'bank');
 assert.equal(resolveLedgerAccount({...request,profile:'另一个人'},store.entities).accountId,null);
 const entities=[...store.entities,{type:'import_rules' as const,id:accountMappingKey({...key,sourceSystem:'ALIPAY'}),fields:{rule_key:accountMappingKey({...key,sourceSystem:'ALIPAY'}),value:null}}];assert.equal(resolveLedgerAccount(request,entities).accountId,null);
 const conflict={entity_type:'import_rules' as const,entity_id:accountMappingKey(key),field:'value',candidates:[]} as any;assert.equal(resolveLedgerAccount(request,store.entities,[conflict]).state,'CONFLICT');
});

test('registered source alias identifies an account independently of its display name',async()=>{
 const {planSetAccountAlias,accountMemoryContext}=await import('../packages/application/account-memory.ts');
 const store=new MemoryStore(fresh());new BusinessAccountingService(store,store.state.device).execute({kind:'CREATE_ACCOUNT',id:'bank',name:'工资卡',accountType:'ASSET',openingBalance:null,openingBalanceAt:now});
 const ledger={entities:store.entities,conflicts:store.conflicts};
 const commands=planSetAccountAlias({accountId:'bank',platform:'微信',profile:'本人',channel:'农业银行储蓄卡 23C2',expectedSnapshot:accountMemoryContext(ledger).expectedSnapshot,now},ledger);new AccountingService(store,store.state.device).execute(commands);
 assert.equal(resolveLedgerAccount({eventKind:'PURCHASE',sourceSystem:'WECHAT',platform:'微信',profile:'本人',channelRaw:'农业银行储蓄卡 23C2',role:'ACCOUNT',sponsored:false},store.entities).accountId,'bank');
 const current={entities:store.entities,conflicts:[]},token=accountMemoryContext(current).expectedSnapshot;
 assert.throws(()=>planSetAccountAlias({accountId:'bank',platform:'微信',profile:'本人',channel:'亲情卡',expectedSnapshot:token,now},current),/ACCOUNT_ALIAS_NOT_APPLICABLE/);
});
