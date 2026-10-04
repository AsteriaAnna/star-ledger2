import test from 'node:test';
import assert from 'node:assert/strict';
import type {Entity} from '../packages/domain/index.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import type {EventInterpretation,ExternalRecord} from '../packages/importing/types.ts';
import type {AccountIdentity,AccountMapping,CategoryMapping,MerchantIdentity,ResolutionMemoryRepository} from '../packages/application/ports.ts';

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
 assert.equal(result.records[0].disposition,'NO_EFFECT');assert.equal(result.records[0].attention.length,0);assert.equal(result.session.noEffectCount,1);assert.equal(result.session.state,'COMPLETED');
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
 assert.equal(result.records[0].disposition,'INTERPRETED');assert.deepEqual(result.records[0].attention,[]);
});

class MemoryRepo implements ResolutionMemoryRepository{
 account=new Map<string,AccountMapping>();
 key(v:AccountIdentity){return JSON.stringify(v);}
 async findAccountMapping(v:AccountIdentity){return this.account.get(this.key(v))??null;}
 async rememberAccountMapping(v:AccountIdentity,m:AccountMapping){this.account.set(this.key(v),m);}
 async findMerchantCategory(_v:MerchantIdentity):Promise<CategoryMapping|null>{return null;}
 async rememberMerchantCategory(_v:MerchantIdentity,_m:CategoryMapping):Promise<void>{}
}
const account=(id:string,name:string):Entity=>({type:'accounts',id,fields:{name,type:'ASSET',last4:'',deleted_at:null,balance_tracking:'ENABLED',balance_state:'ESTABLISHED',opening_balance:0,opening_balance_at:'2026-01-01T00:00:00Z'}});

test('import service uses memory only after deterministic account resolution cannot decide',async()=>{
 const memories=new MemoryRepo(),service=new ImportStatementService(new InMemoryImportWorkspace(),memories);
 const ledger={entities:[account('a1','自定义一'),account('a2','自定义二')],conflicts:[]};
 const request={eventKind:'PURCHASE',sourceSystem:'ALIPAY',platform:'支付宝',profile:'本人',channelRaw:'余额',role:'ACCOUNT' as const,sponsored:false};
 let result=await service.resolveFundingAccount(request,ledger);assert.equal(result.state,'UNRESOLVED');
 await service.rememberFundingAccount(request,'a2',ledger,'2026-10-02T00:00:00Z');
 result=await service.resolveFundingAccount(request,ledger);assert.equal(result.state,'RESOLVED');assert.equal(result.accountId,'a2');
});

test('deterministic unique account outranks stale remembered mapping',async()=>{
 const memories=new MemoryRepo(),service=new ImportStatementService(new InMemoryImportWorkspace(),memories);
 const request={eventKind:'PURCHASE',sourceSystem:'ALIPAY',platform:'支付宝',profile:'本人',channelRaw:'余额',role:'ACCOUNT' as const,sponsored:false};
 const before={entities:[account('old','旧账户')],conflicts:[]};
 await service.rememberFundingAccount(request,'old',before,'2026-10-01T00:00:00Z');
 const ledger={entities:[account('old','旧账户'),account('wallet','支付宝余额')],conflicts:[]};
 const result=await service.resolveFundingAccount(request,ledger);assert.equal(result.accountId,'wallet');assert.equal(result.reason,'按明确资金渠道唯一匹配');
});


test('same source identity with changed official evidence is not silently skipped as duplicate',async()=>{
 const workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace),r={...record('source-1'),rawPayload:'raw-v2'};
 const entities:Entity[]=[transaction('t1'),{type:'source_records',id:'sr-v1',fields:{transaction_id:'t1',source_type:'EXCEL',platform:'支付宝',raw_payload:JSON.stringify({version:3,identity:'source-1',profile:'本人',order:'source-1',original:'raw-v1'}),created_at:'2026-09-20T04:00:00Z'}}];
 const result=await service.prepare({sessionId:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',records:[r],interpretations:[interpretation(r.id)],ledger:{entities,conflicts:[]},now:'2026-10-02T00:00:00Z'});
 assert.equal(result.records[0].disposition,'SOURCE_UPDATE');assert.equal(result.records[0].transactionId,'t1');
 assert.equal(result.records[0].attention[0].kind,'SOURCE_UPDATE');assert.equal(result.records[0].attention[0].blocking,true);
});

test('same source identity with the same V3 evidence remains an exact idempotent replay',async()=>{
 const workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace),r={...record('source-1'),rawPayload:'same-raw'};
 const entities:Entity[]=[transaction('t1'),{type:'source_records',id:'sr',fields:{transaction_id:'t1',source_type:'EXCEL',platform:'支付宝',raw_payload:JSON.stringify({version:3,identity:'source-1',profile:'本人',order:'source-1',original:'same-raw'}),created_at:'2026-09-20T04:00:00Z'}}];
 const result=await service.prepare({sessionId:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',records:[r],interpretations:[interpretation(r.id)],ledger:{entities,conflicts:[]},now:'2026-10-02T00:00:00Z'});
 assert.equal(result.records[0].disposition,'SKIP_DUPLICATE');assert.equal(result.session.skippedDuplicateCount,1);
});


test('same batch conflicting usable snapshots block the group instead of trusting file order',async()=>{
 const workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace);
 const first={...record('row-1'),sourceIdentity:'same-event',rawPayload:'snapshot-1'},later={...record('row-2'),sourceIdentity:'same-event',rawPayload:'snapshot-2'};
 const result=await service.prepare({sessionId:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',records:[first,later],interpretations:[interpretation(first.id),interpretation(later.id)],ledger:{entities:[],conflicts:[]},now:'2026-10-02T00:00:00Z'});
 assert.equal(result.records[0].disposition,'NEEDS_ATTENTION');assert.equal(result.records[1].disposition,'NEEDS_ATTENTION');
 assert.equal(result.records[1].attention[0].kind,'SOURCE_UPDATE');
});

test('same batch exact source replay collapses without creating a second financial event',async()=>{
 const workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace);
 const first={...record('row-1'),sourceIdentity:'same-event',rawPayload:'same'},again={...record('row-2'),sourceIdentity:'same-event',rawPayload:'same'};
 const result=await service.prepare({sessionId:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',records:[first,again],interpretations:[interpretation(first.id),interpretation(again.id)],ledger:{entities:[],conflicts:[]},now:'2026-10-02T00:00:00Z'});
 assert.equal(result.records[0].disposition,'INTERPRETED');assert.equal(result.records[1].disposition,'SKIP_DUPLICATE');assert.equal(result.session.skippedDuplicateCount,1);
});

test('failed observation never consumes the identity of a later successful observation in either order',async()=>{
 for(const reverse of [false,true]){
  const rows=[{...record('failed'),sourceIdentity:'order',rawPayload:'failed'},{...record('success'),sourceIdentity:'order',rawPayload:'success'}];
  if(reverse)rows.reverse();
  const service=new ImportStatementService(new InMemoryImportWorkspace());
  const result=await service.prepare({sessionId:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',records:rows,interpretations:rows.map(r=>interpretation(r.id,{status:r.id==='failed'?'FAILED':'SUCCESS'})),ledger:{entities:[],conflicts:[]},now:'2026-10-03T00:00:00Z'});
  assert.equal(result.records.find(r=>r.externalRecordId==='failed')?.disposition,'NO_EFFECT');
  assert.equal(result.records.find(r=>r.externalRecordId==='success')?.disposition,'INTERPRETED');
 }
});

test('changed evidence for a deleted transaction requires a decision instead of restoring and overwriting',async()=>{
 const r={...record('source-1'),rawPayload:'changed'};
 const ledger={entities:[transaction('t1','2026-10-02T00:00:00Z'),{type:'source_records' as const,id:'sr',fields:{transaction_id:'t1',source_type:'EXCEL',platform:'支付宝',raw_payload:JSON.stringify({version:3,identity:'source-1',profile:'本人',original:'original'})}}],conflicts:[]};
 const result=await new ImportStatementService(new InMemoryImportWorkspace()).prepare({sessionId:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',records:[r],interpretations:[interpretation(r.id)],ledger,now:'2026-10-03T00:00:00Z'});
 assert.equal(result.records[0].disposition,'NEEDS_ATTENTION');assert.equal(result.records[0].attention[0].kind,'SOURCE_UPDATE');
});
