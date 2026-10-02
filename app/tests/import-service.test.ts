import test from 'node:test';
import assert from 'node:assert/strict';
import type {Entity} from '../packages/domain/index.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import type {EventInterpretation,ExternalRecord} from '../packages/importing/types.ts';

const record=(id:string):ExternalRecord=>({id,sessionId:'s',sourceIdentity:id,sourceType:'EXCEL',sourceSystem:'ALIPAY',platformRaw:'支付宝',profile:'本人',rawPayload:'{}',parserVersion:3,capturedAt:'2026-10-02T00:00:00Z',facts:{occurredAt:'2026-09-20T04:00:00Z',amountFen:1000,transactionTypeRaw:'消费',directionRaw:'支出',statusRaw:'交易成功',channelRaw:'余额',counterpartyRaw:'商户',productRaw:'商品',noteRaw:'',sourceCategoryRaw:'',orderId:id,refundId:null,originalOrderId:null,precision:'second'}});
const interpretation=(id:string,patch:Partial<EventInterpretation>={}):EventInterpretation=>({externalRecordId:id,eventKind:'PURCHASE',status:'SUCCESS',amountFen:1000,occurredAt:'2026-09-20T04:00:00Z',displayName:'商品',channelRaw:'余额',categorySuggestion:'购物',evidence:[],...patch});
const transaction=(id:string,deleted_at:string|null=null):Entity=>({type:'transactions',id,fields:{event_type:'PURCHASE',status:'SUCCESS',occurred_at:'2026-09-20T04:00:00Z',display_amount:1000,display_name:'商品',note:'',created_at:'2026-09-20T04:00:00Z',deleted_at,purged_at:null}});

test('prepare auto-skips exact durable duplicate',async()=>{
 const workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace),r=record('source-1');
 const entities:Entity[]=[transaction('t1'),{type:'source_records',id:'sr',fields:{transaction_id:'t1',source_type:'EXCEL',platform:'支付宝',raw_payload:JSON.stringify({identity:'source-1',profile:'本人',order:'source-1'}),created_at:'2026-09-20T04:00:00Z'}}];
 const result=await service.prepare({sessionId:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',records:[r],interpretations:[interpretation(r.id)],ledger:{entities,conflicts:[]},now:'2026-10-02T00:00:00Z'});
 assert.equal(result.records[0].disposition,'SKIP_DUPLICATE');assert.equal(result.records[0].transactionId,'t1');assert.equal(result.session.skippedDuplicateCount,1);
});

test('prepare revives one deleted source instead of creating a duplicate',async()=>{
 const workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace),r=record('source-1');
 const entities:Entity[]=[transaction('t1','2026-09-21T00:00:00Z'),{type:'source_records',id:'sr',fields:{transaction_id:'t1',source_type:'EXCEL',platform:'支付宝',raw_payload:JSON.stringify({identity:'source-1'}),created_at:'2026-09-20T04:00:00Z'}}];
 const result=await service.prepare({sessionId:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',records:[r],interpretations:[interpretation(r.id)],ledger:{entities,conflicts:[]},now:'2026-10-02T00:00:00Z'});
 assert.equal(result.records[0].disposition,'REVIVE_EXISTING');assert.equal(result.records[0].transactionId,'t1');
});

test('failed source is preserved as no-effect without asking for missing amount/date',async()=>{
 const workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace),r=record('failed');
 const result=await service.prepare({sessionId:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',records:[r],interpretations:[interpretation(r.id,{status:'FAILED',amountFen:null,occurredAt:null,eventKind:'UNKNOWN'})],ledger:{entities:[],conflicts:[]},now:'2026-10-02T00:00:00Z'});
 assert.equal(result.records[0].disposition,'NO_EFFECT');assert.equal(result.records[0].attention.length,0);
 assert.deepEqual((await workspace.listExternalRecords('s')).map(x=>x.id),['failed']);
});

test('unknown accounting facts create scoped blocking attention',async()=>{
 const workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace),r=record('uncertain');
 const result=await service.prepare({sessionId:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',records:[r],interpretations:[interpretation(r.id,{amountFen:null,eventKind:'UNKNOWN'})],ledger:{entities:[],conflicts:[]},now:'2026-10-02T00:00:00Z'});
 assert.equal(result.records[0].disposition,'NEEDS_ATTENTION');
 assert.deepEqual(result.records[0].attention.map(x=>x.kind).sort(),['AMOUNT','EVENT_MEANING']);
 assert.equal(result.session.state,'NEEDS_ATTENTION');
});

test('non-duplicate deterministic source becomes ready without workflow confirmation',async()=>{
 const workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace),r=record('ready');
 const result=await service.prepare({sessionId:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',records:[r],interpretations:[interpretation(r.id)],ledger:{entities:[],conflicts:[]},now:'2026-10-02T00:00:00Z'});
 assert.equal(result.records[0].disposition,'READY');assert.deepEqual(result.records[0].attention,[]);
});
