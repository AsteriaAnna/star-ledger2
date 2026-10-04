import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLegacyImportBatch} from '../apps/web/src/import-v2-flow.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import type {Draft} from '../apps/web/src/importer.ts';

const now='2026-10-02T12:00:00Z',ledger={entities:[],conflicts:[]};
const draft=(overrides:Partial<Draft>={}):Draft=>({key:'identity-1',identity:'identity-1',itemId:'row-1',platform:'微信',profile:'本人',name:'午餐',amount:'25.00',date:'2026-10-01T18:00:00',kind:'PURCHASE',status:'SUCCESS',channel:'零钱',account:'',to:'',category:'餐饮',original:'',note:'',raw:JSON.stringify({'交易类型':'商户消费','收/支':'支出','当前状态':'支付成功','支付方式':'零钱','交易单号':'order-1'}),issue:'旧版要求核对账户',selected:false,sourceType:'EXCEL',order:'order-1',sponsor:false,consumption:'0',blockers:['ACCOUNT'],confirmed:[],workflow:'review',parserVersion:3,...overrides});

test('legacy Draft workflow flags no longer decide whether a known record can auto-commit',async()=>{
 const service=new ImportStatementService(new InMemoryImportWorkspace());
 const out=await resolveLegacyImportBatch({drafts:[draft()],sessionId:'s',ledger,now,service});
 assert.equal(out.result.records[0].ledgerState,'READY_FOR_LEDGER');
 assert.equal(out.plan.newRecords.length,1);assert.deepEqual(out.plan.blockedRecordIds,[]);
 assert.equal(out.result.records[0].attention.some(item=>item.kind==='ACCOUNT'&&item.blocking),false);
});

test('failed source row becomes no-effect instead of a user review task',async()=>{
 const service=new ImportStatementService(new InMemoryImportWorkspace());
 const out=await resolveLegacyImportBatch({drafts:[draft({status:'FAILED',workflow:'review',issue:'旧版仍显示待处理'})],sessionId:'s',ledger,now,service});
 assert.deepEqual(out.plan.noEffectRecordIds,['s:observation:0']);assert.equal(out.plan.newRecords.length,0);
});

test('split funding with unknown allocation remains the explicit blocking exception',async()=>{
 const service=new ImportStatementService(new InMemoryImportWorkspace());
 const split=draft({channel:'零钱 + 某银行储蓄卡(1234)'});split.raw=JSON.stringify({'交易类型':'商户消费','收/支':'支出','当前状态':'支付成功','支付方式':'零钱 + 某银行储蓄卡(1234)','交易单号':'order-1'});
 const out=await resolveLegacyImportBatch({drafts:[split],sessionId:'s',ledger,now,service});
 assert.equal(out.result.records[0].ledgerState,'NEEDS_ATTENTION');
 assert.equal(out.result.records[0].attention.some(item=>item.kind==='SPLIT_PAYMENT'&&item.blocking),true);
 assert.deepEqual(out.plan.blockedRecordIds,['s:observation:0']);
});

test('retired legacy source review moves into the current explicit source-answer flow',async()=>{
 const d=draft(),base={entities:[{type:'transactions',id:'old',fields:{event_type:'INCOME',status:'SUCCESS',display_amount:2500,occurred_at:'2026-10-01T10:00:00.000Z',display_name:'旧解释'}},{type:'source_records',id:'old-evidence',fields:{transaction_id:'old',platform:'微信',raw_payload:JSON.stringify({version:2,identity:d.identity,profile:'本人',order:d.order,original:d.raw})}}],conflicts:[]} as any;
 const out=await resolveLegacyImportBatch({drafts:[d],sessionId:'legacy-review',ledger:base,now,service:new ImportStatementService(new InMemoryImportWorkspace())});
 assert.equal(out.result.records[0].disposition,'SOURCE_UPDATE');assert.equal(out.result.records[0].transactionId,'old');assert.equal(out.result.records[0].attention[0].kind,'SOURCE_UPDATE');assert.equal(out.result.session.skippedDuplicateCount,0);assert.equal(out.plan.newRecords.length,0);
 // Current evidence must retain its normal reimport policy even after user edits.
 base.entities[1].fields.raw_payload=JSON.stringify({version:3,identity:d.identity,profile:'本人',order:d.order,original:d.raw});
 const modern=await resolveLegacyImportBatch({drafts:[d],sessionId:'modern-repeat',ledger:base,now,service:new ImportStatementService(new InMemoryImportWorkspace())});
 assert.equal(modern.result.records[0].disposition,'SKIP_DUPLICATE');assert.deepEqual(modern.result.records[0].attention,[]);
});
