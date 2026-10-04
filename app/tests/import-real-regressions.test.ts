import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLegacyImportBatch} from '../apps/web/src/import-v2-flow.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import {legacyDraftToExternalRecord} from '../apps/web/src/import-v2-adapter.ts';
import {refundOriginalOrder} from '../packages/importing/refund-order.ts';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import type {Draft} from '../apps/web/src/importer.ts';
const now='2026-10-05T00:00:00Z';
const draft=(overrides:Partial<Draft>={}):Draft=>({key:'withdrawal',identity:'withdrawal',itemId:'withdrawal',platform:'微信',profile:'本人',name:'零钱提现',amount:'300.00',fee:'0.00',date:'2026-09-01T12:00:00',kind:'WITHDRAWAL',status:'SUCCESS',channel:'农业银行储蓄卡(2372)',account:'',to:'',category:'其他',original:'',note:'',raw:JSON.stringify({'交易类型':'零钱提现','支付方式':'农业银行储蓄卡(2372)','当前状态':'提现已到账'}),issue:'',selected:false,sourceType:'EXCEL',order:'withdrawal',sponsor:false,consumption:'0',blockers:[],...overrides});
function ledger(){const s=new MemoryStore(fresh()),svc=new BusinessAccountingService(s,s.state.device);for(const [id,name,type] of [['wallet','微信零钱','ASSET'],['bank','农业银行储蓄卡(2372)','ASSET'],['huabei','花呗','LIABILITY']] as const)svc.execute({kind:'CREATE_ACCOUNT',id,name,accountType:type,openingBalance:0,openingBalanceAt:'2026-08-01T00:00:00Z',last4:id==='bank'?'2372':''});return s;}
test('real-format zero fee withdrawal resolves wallet -> bank and has no false questions',async()=>{
 const store=ledger(),out=await resolveLegacyImportBatch({drafts:[draft()],sessionId:'zero',ledger:{entities:store.entities,conflicts:[]},now,service:new ImportStatementService(new InMemoryImportWorkspace())});
 const intent=out.plan.newRecords[0].intent;assert.equal(intent.kind,'WITHDRAWAL');if(intent.kind!=='WITHDRAWAL')throw Error();
 assert.equal(intent.from,'wallet');assert.equal(intent.to,'bank');assert.equal(intent.fee,0);assert.deepEqual(out.result.records[0].attention,[]);
 new BusinessAccountingService(store,store.state.device).execute(intent);
 const moves=store.entities.filter(e=>e.type==='balance_movements');assert.deepEqual(moves.map(e=>[e.fields.account_id,e.fields.amount]),[['wallet',-30000],['bank',30000]]);
 assert.equal(legacyDraftToExternalRecord(draft({fee:'0',blockers:['TRANSFER']}),'unknown',now).facts.feeFen,null);
});
test('explicit withdrawal fees and Huabei repayment use source roles without second consumption',async()=>{
 const store=ledger();
 for(const [d,kind,from,to,fee] of [[draft({fee:'1.50',amount:'1500'}),'WITHDRAWAL','wallet','bank',150],[draft({kind:'REPAYMENT',platform:'支付宝',name:'花呗还款',channel:'农业银行储蓄卡(2372)',raw:'{}'}),'REPAYMENT','bank','huabei',undefined]] as const){
 const out=await resolveLegacyImportBatch({drafts:[d],sessionId:kind,ledger:{entities:store.entities,conflicts:[]},now,service:new ImportStatementService(new InMemoryImportWorkspace())});
 const intent=out.plan.newRecords[0].intent;assert.equal(intent.kind,kind);assert.equal((intent as any).from,from);assert.equal((intent as any).to,to);if(fee!==undefined)assert.equal((intent as any).fee,fee);
 new BusinessAccountingService(store,store.state.device).execute(intent);
 }
 assert.equal(store.entities.filter(e=>e.type==='consumption_effects').reduce((n,e)=>n+Number(e.fields.amount),0),150);
});
test('all observed refund suffix families yield the same claim; other platform/order unchanged',()=>{
 const base='202609010000000123456789';
 for(const suffix of ['_1','_123_456','_123_advance','*REFUND_P123R456','*123','_123R456','*REFUND_1'])assert.equal(refundOriginalOrder('支付宝',base+suffix),base);
 assert.equal(refundOriginalOrder('支付宝',base),null);assert.equal(refundOriginalOrder('微信',base+'_1'),null);assert.equal(refundOriginalOrder('支付宝',base+'_1','explicit'),'explicit');
});
