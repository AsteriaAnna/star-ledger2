import test from 'node:test';
import assert from 'node:assert/strict';
import type {Entity} from '../packages/domain/index.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import type {EventInterpretation,ExternalRecord} from '../packages/importing/types.ts';

const account=(id:string,name:string,type:'ASSET'|'LIABILITY'='ASSET',last4=''):Entity=>({type:'accounts',id,fields:{name,type,last4,deleted_at:null,balance_tracking:'ENABLED',balance_state:'ESTABLISHED',opening_balance:0,opening_balance_at:'2026-01-01T00:00:00Z'}});
const tx=(id:string,kind='PURCHASE',amount=1000):Entity=>({type:'transactions',id,fields:{event_type:kind,status:'SUCCESS',occurred_at:'2026-09-01T00:00:00Z',display_amount:amount,display_name:'原消费',note:'',created_at:'2026-09-01T00:00:00Z',deleted_at:null,purged_at:null}});
const sourceEvidence=(id:string,transactionId:string,order:string):Entity=>({type:'source_records',id,fields:{transaction_id:transactionId,source_type:'EXCEL',platform:'微信',raw_payload:JSON.stringify({order,profile:'本人',original:'{}'}),created_at:'2026-09-01T00:00:00Z'}});
const movement=(id:string,transactionId:string,accountId:string|null,amount:number):Entity=>({type:'balance_movements',id,fields:{transaction_id:transactionId,account_id:accountId,amount,created_at:'2026-09-01T00:00:00Z'}});
const record=(id:string,patch:Partial<ExternalRecord>={}):ExternalRecord=>({id,sessionId:'s',sourceIdentity:id,sourceType:'EXCEL',sourceSystem:'ALIPAY',platformRaw:'支付宝',profile:'本人',rawPayload:'{}',parserVersion:3,capturedAt:'2026-10-02T00:00:00Z',facts:{occurredAt:'2026-09-20T04:00:00Z',amountFen:1000,transactionTypeRaw:'消费',directionRaw:'支出',statusRaw:'交易成功',channelRaw:'余额',counterpartyRaw:'商户',productRaw:'商品',noteRaw:'',sourceCategoryRaw:'',orderId:id,refundId:null,originalOrderId:null,precision:'second'},...patch});
const interpretation=(id:string,patch:Partial<EventInterpretation>={}):EventInterpretation=>({externalRecordId:id,eventKind:'PURCHASE',status:'SUCCESS',amountFen:1000,occurredAt:'2026-09-20T04:00:00Z',displayName:'商品',channelRaw:'余额',categorySuggestion:'购物',evidence:[],...patch});

async function pipeline(r:ExternalRecord,i:EventInterpretation,entities:Entity[]=[]){
 const service=new ImportStatementService(new InMemoryImportWorkspace());
 const ledger={entities,conflicts:[]};
 const prepared=await service.prepare({sessionId:'s',sourceType:r.sourceType,sourceSystem:r.sourceSystem,records:[r],interpretations:[i],ledger,now:'2026-10-02T00:00:00Z'});
 return service.resolve({prepared,records:[r],ledger,now:'2026-10-02T00:00:01Z'});
}

test('unknown explicit account is non-blocking because ledger supports unresolved movements',async()=>{
 const r=record('unknown-account',{facts:{...record('x').facts,channelRaw:'某银行储蓄卡(1234)',orderId:'unknown-account'}});
 const result=await pipeline(r,interpretation(r.id,{channelRaw:r.facts.channelRaw}));
 assert.equal(result.records[0].ledgerState,'READY_FOR_LEDGER');
 assert.equal(result.records[0].account?.state,'UNRESOLVED');
 assert.equal(result.records[0].attention.find(x=>x.kind==='ACCOUNT')?.blocking,false);
});

test('unique explicit account resolves without attention',async()=>{
 const r=record('known',{facts:{...record('x').facts,channelRaw:'招商银行储蓄卡(1234)',orderId:'known'}});
 const result=await pipeline(r,interpretation(r.id,{channelRaw:r.facts.channelRaw}),[account('bank','招商银行卡(1234)','ASSET','1234')]);
 assert.equal(result.records[0].ledgerState,'READY_FOR_LEDGER');assert.equal(result.records[0].account?.accountId,'bank');assert.equal(result.records[0].attention.length,0);
});

test('split funding blocks posting instead of guessing one account',async()=>{
 const r=record('split',{facts:{...record('x').facts,channelRaw:'余额+招商银行储蓄卡(1234)',orderId:'split'}});
 const result=await pipeline(r,interpretation(r.id,{channelRaw:r.facts.channelRaw}),[account('wallet','支付宝余额')]);
 assert.equal(result.records[0].ledgerState,'NEEDS_ATTENTION');assert.equal(result.records[0].attention.find(x=>x.kind==='SPLIT_PAYMENT')?.blocking,true);
});

test('ordinary external transfer does not create purpose attention',async()=>{
 const r=record('transfer',{facts:{...record('x').facts,transactionTypeRaw:'转账',channelRaw:'余额',orderId:'transfer'}});
 const result=await pipeline(r,interpretation(r.id,{eventKind:'EXTERNAL_TRANSFER'}),[account('wallet','支付宝余额')]);
 assert.equal(result.records[0].ledgerState,'READY_FOR_LEDGER');
 assert.equal(result.records[0].attention.some(x=>x.kind==='EVENT_MEANING'),false);
});

test('unmatched refund relation is not turned into a visible blocking task',async()=>{
 const r=record('refund',{sourceSystem:'WECHAT',platformRaw:'微信',facts:{...record('x').facts,channelRaw:'/',transactionTypeRaw:'商户退款',directionRaw:'收入',orderId:'refund',refundId:'refund'}});
 const result=await pipeline(r,interpretation(r.id,{eventKind:'REFUND',channelRaw:'/'}));
 assert.equal(result.records[0].ledgerState,'READY_FOR_LEDGER');assert.equal(result.records[0].relation?.state,'UNRESOLVED');assert.equal(result.records[0].attention.some(x=>x.kind==='REFUND_RELATION'),false);
});

test('weak refund candidate is non-blocking and never becomes a confirmed relation',async()=>{
 const r=record('refund',{sourceSystem:'WECHAT',platformRaw:'微信',facts:{...record('x').facts,channelRaw:'/',transactionTypeRaw:'商户退款',directionRaw:'收入',orderId:'refund',refundId:'refund'}});
 const result=await pipeline(r,interpretation(r.id,{eventKind:'REFUND',displayName:'原消费退款',channelRaw:'/'}),[tx('t1')]);
 assert.equal(result.records[0].ledgerState,'READY_FOR_LEDGER');assert.equal(result.records[0].relation?.state,'SUGGESTED');assert.equal(result.records[0].relation?.originalId,null);assert.equal(result.records[0].attention.find(x=>x.kind==='REFUND_RELATION')?.blocking,false);
});

test('strong refund relation may infer original destination without requiring source channel',async()=>{
 const r=record('refund',{sourceSystem:'WECHAT',platformRaw:'微信',facts:{...record('x').facts,channelRaw:'/',transactionTypeRaw:'商户退款',directionRaw:'收入',orderId:'refund',refundId:'refund',originalOrderId:'paid'}});
 const entities=[account('wallet','微信零钱'),tx('t1'),sourceEvidence('src','t1','paid'),movement('m1','t1','wallet',-1000)];
 const result=await pipeline(r,interpretation(r.id,{eventKind:'REFUND',channelRaw:'/'}),entities);
 assert.equal(result.records[0].relation?.state,'RESOLVED');assert.equal(result.records[0].relation?.destinationAccountId,'wallet');assert.equal(result.records[0].ledgerState,'READY_FOR_LEDGER');
});

test('repayment preserves the known event while unresolved liability endpoint becomes non-blocking attention',async()=>{
 const r=record('repay',{facts:{...record('x').facts,transactionTypeRaw:'花呗还款',channelRaw:'招商银行储蓄卡(1234)',orderId:'repay'}});
 const result=await pipeline(r,interpretation(r.id,{eventKind:'REPAYMENT',channelRaw:r.facts.channelRaw}),[account('bank','招商银行卡(1234)','ASSET','1234'),account('huabei','花呗','LIABILITY')]);
 assert.equal(result.records[0].ledgerState,'READY_FOR_LEDGER');assert.equal(result.records[0].attention.find(x=>x.kind==='TRANSFER_ENDPOINTS')?.blocking,false);
});

test('strong refund relation still blocks when partial-consumption allocation is genuinely ambiguous',async()=>{
 const r=record('refund-partial',{sourceSystem:'WECHAT',platformRaw:'微信',facts:{...record('x').facts,channelRaw:'/',transactionTypeRaw:'商户退款',directionRaw:'收入',amountFen:200,orderId:'refund-partial',refundId:'refund-partial',originalOrderId:'paid'}});
 const entities=[tx('t1','PURCHASE',1000),sourceEvidence('src','t1','paid'),{type:'consumption_effects',id:'t1:effect',fields:{transaction_id:'t1',amount:600,category_id:'购物',subcategory_id:null,effective_at:'2026-09-01T00:00:00Z',created_at:'2026-09-01T00:00:00Z'}} as Entity];
 const result=await pipeline(r,interpretation(r.id,{eventKind:'REFUND',amountFen:200,channelRaw:'/'}),entities);
 assert.equal(result.records[0].relation?.state,'RESOLVED');assert.equal(result.records[0].ledgerState,'NEEDS_ATTENTION');assert.equal(result.records[0].attention.find(x=>x.kind==='CONSUMPTION_ALLOCATION')?.blocking,true);
});
