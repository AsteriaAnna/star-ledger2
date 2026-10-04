import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {accountMemoryContext,planForgetAccountMemory} from '../packages/application/account-memory.ts';
import {rememberAccountMappingCommand,accountMappingKey,legacyAccountMemoryMigrationCommands,readAccountMapping} from '../packages/importing/resolution-memory.ts';
import {rememberAccountCommands} from '../apps/web/src/import-accounts.ts';
import {resolveAccount} from '../apps/web/src/account-matcher.ts';
import {parseRows,csv} from '../apps/web/src/importer.ts';
const at='2026-10-04T04:00:00Z',key={sourceSystem:'WECHAT',profile:'本人',channelKey:'农业银行:debit:2372',role:'PRIMARY'};
function fixture(){
 const store=new MemoryStore(fresh()),business=new BusinessAccountingService(store,store.state.device),service=new AccountingService(store,store.state.device);
 business.execute({kind:'CREATE_ACCOUNT',id:'bank',name:'旅行账户',accountType:'ASSET',openingBalance:0,openingBalanceAt:at});business.execute({kind:'CREATE_ACCOUNT',id:'other',name:'另一账户',accountType:'ASSET',openingBalance:0,openingBalanceAt:at});
 business.execute({kind:'PURCHASE',id:'p',name:'历史消费',amount:1000,payer:'bank',occurredAt:at,source:{id:'evidence',sourceType:'EXCEL',platform:'微信',rawPayload:'immutable'}});
 const d=parseRows(csv('微信支付账单明细\n交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号\n2026-10-04 12:00:00,商户消费,商店,商品,支出,10,农业银行储蓄卡(2372),支付成功,order\n'))[0];d.profile='本人';
 service.execute(rememberAccountCommands(store.entities,d,'account','bank'));service.execute([rememberAccountMappingCommand(store.entities,key,{accountId:'bank',rememberedAt:at})]);
 const snap=()=>({entities:store.entities,conflicts:store.conflicts});
 const forget=(entryIds:readonly string[]|'ALL',expectedSnapshot=accountMemoryContext(snap()).expectedSnapshot)=>service.execute(s=>planForgetAccountMemory({entryIds,expectedSnapshot},s));
 return {store,business,service,d,snap,forget};
}
test('forget groups typed memory with old alias and fallback while retaining historical facts and decisions',()=>{
 const h=fixture(),context=accountMemoryContext(h.snap());assert.equal(context.entries.length,1);assert.equal(context.entries[0].ruleIds.length,3);assert.ok(context.entries[0].scopes.every(s=>!s.channel.includes(':debit:')));
 h.service.execute([{action:'CREATE_ENTITY',entity:{type:'import_rules',id:'refund-relation:p',fields:{rule_key:'refund-relation:p',value:'{"version":1,"originalId":null}'}}}]);
 const history=structuredClone(h.store.entities.filter(e=>e.type!=='import_rules'));h.forget([context.entries[0].id]);
 assert.equal(accountMemoryContext(h.snap()).entries.length,0);assert.equal(readAccountMapping(h.store.entities,key),null);assert.deepEqual(legacyAccountMemoryMigrationCommands(h.store.entities,at),[]);assert.deepEqual(h.store.entities.filter(e=>e.type!=='import_rules'),history);assert.ok(h.store.entities.find(e=>e.id==='refund-relation:p')?.fields.value);
 assert.notEqual(resolveAccount(h.d,h.store.entities.filter(e=>e.type==='accounts'),h.store.entities.filter(e=>e.type==='import_rules'),[]).state,'confirmed');
});
test('forgetting one scope retains other profiles and unrelated memory even with the same account',()=>{
 const h=fixture(),otherKey={...key,profile:'家人'};h.service.execute([rememberAccountMappingCommand(h.store.entities,otherKey,{accountId:'bank',rememberedAt:at})]);
 const context=accountMemoryContext(h.snap()),own=context.entries.find(e=>e.scopes.some(s=>s.profile==='本人'))!;h.forget([own.id]);assert.equal(readAccountMapping(h.store.entities,otherKey)?.accountId,'bank');assert.equal(accountMemoryContext(h.snap()).entries.length,1);
});
test('shared legacy fallback joins its actual cross-platform influence into the review scope',()=>{
 const h=fixture(),d={...h.d,platform:'支付宝'};h.service.execute(rememberAccountCommands(h.store.entities,d,'account','other'));const context=accountMemoryContext(h.snap());assert.equal(context.entries.length,1);assert.ok(context.entries[0].scopes.some(s=>s.platform==='支付宝'&&s.accountId==='other'));h.forget([context.entries[0].id]);assert.equal(accountMemoryContext(h.snap()).entries.length,0);
});
test('stale memory rejects forgetting and financial changes do not invalidate an unchanged memory preview',()=>{
 const h=fixture(),context=accountMemoryContext(h.snap());h.service.execute([rememberAccountMappingCommand(h.store.entities,key,{accountId:'other',rememberedAt:at})]);const before=structuredClone(h.store.state);assert.throws(()=>h.forget('ALL',context.expectedSnapshot),/STALE_ACCOUNT_MEMORY/);assert.deepEqual(h.store.state,before);
 const next=accountMemoryContext(h.snap());h.business.execute({kind:'INCOME',id:'new',name:'新收入',amount:100,destination:'bank',occurredAt:at});h.forget('ALL',next.expectedSnapshot);assert.equal(accountMemoryContext(h.snap()).entries.length,0);
});
test('forget-all includes orphan old fallbacks, rolls back write failure, and allows explicit new memory afterward',()=>{
 const h=fixture();h.service.execute([{action:'CREATE_ENTITY',entity:{type:'import_rules',id:'instrument-orphan',fields:{rule_key:'instrument-orphan',value:JSON.stringify({accountId:'other'})}}}]);assert.equal(accountMemoryContext(h.snap()).entries.length,2);
 const before=structuredClone(h.store.state),append=h.store.append.bind(h.store);let writes=0;h.store.append=(op,local)=>{append(op,local);if(++writes===2)throw Error('WRITE_FAILURE');};assert.throws(()=>h.forget('ALL'),/WRITE_FAILURE/);assert.deepEqual(h.store.state,before);h.store.append=append;h.forget('ALL');
 // An old alias arriving later must not resurrect an explicit typed tombstone.
 h.service.execute([{action:'CREATE_ENTITY',entity:{type:'import_rules',id:'alias-later',fields:{rule_key:'alias-later',value:JSON.stringify({v:1,platform:'微信',profile:'本人',channel:'农业银行储蓄卡(2372)',role:'付款账户',accountId:'bank'})}}}]);assert.deepEqual(legacyAccountMemoryMigrationCommands(h.store.entities,at),[]);
 h.service.execute([rememberAccountMappingCommand(h.store.entities,key,{accountId:'other',rememberedAt:at})]);assert.equal(readAccountMapping(h.store.entities,key)?.accountId,'other');assert.equal(h.store.entities.find(e=>e.id===accountMappingKey(key))?.fields.value!==null,true);
});
