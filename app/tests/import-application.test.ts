import test from 'node:test';
import assert from 'node:assert/strict';
import type {Entity} from '../packages/domain/index.ts';
import {findSourceMatch} from '../packages/importing/dedup.ts';
import {attentionId,summarizeSession} from '../packages/importing/attention.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import type {AttentionItem,ImportSession} from '../packages/importing/types.ts';

const tx=(id:string,deleted:string|null=null):Entity=>({type:'transactions',id,fields:{purged_at:null,event_type:'PURCHASE',status:'SUCCESS',occurred_at:'2026-09-20T04:00:00Z',display_amount:100,display_name:'x',note:'',created_at:'2026-09-20T04:00:00Z',deleted_at:deleted}});
test('source dedup truth comes from durable source/rule evidence, not import session state',()=>{
 const entities:Entity[]=[
  tx('t1'),
  {type:'source_records',id:'s1',fields:{transaction_id:'t1',source_type:'EXCEL',platform:'支付宝',raw_payload:JSON.stringify({identity:'stable-1',profile:'本人',order:'o1'}),created_at:'2026-09-20T04:00:00Z'}}
 ];
 const result=findSourceMatch({value:'stable-1',platform:'支付宝',profile:'本人',orderId:'o1'},entities);
 assert.deepEqual(result.activeTransactionIds,['t1']);assert.ok(result.matchedBy.includes('SOURCE_IDENTITY'));
});

test('deleted source match is distinguishable from active duplicate',()=>{
 const entities:Entity[]=[
  tx('t1','2026-09-21T00:00:00Z'),
  {type:'import_rules',id:'source-stable-1',fields:{rule_key:'source-stable-1',value:JSON.stringify({transactionId:'t1'})}}
 ];
 const result=findSourceMatch({value:'stable-1',platform:'支付宝',profile:'本人'},entities);
 assert.deepEqual(result.activeTransactionIds,[]);assert.deepEqual(result.deletedTransactionIds,['t1']);
});

test('attention summary only blocks completion for blocking questions',()=>{
 const base:ImportSession={id:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',createdAt:'a',updatedAt:'a',state:'PROCESSING',sourceCount:2,committedCount:1,skippedDuplicateCount:1,blockingAttentionCount:0,nonBlockingAttentionCount:0,failureCode:null};
 const info:AttentionItem={id:attentionId('s','r','REFUND_RELATION'),sessionId:'s',externalRecordId:'r',kind:'REFUND_RELATION',question:'可关联原消费',blocking:false,candidates:[],createdAt:'a'};
 assert.equal(summarizeSession(base,[info],'b').state,'COMPLETED');
 assert.equal(summarizeSession(base,[{...info,id:attentionId('s','r','AMOUNT'),kind:'AMOUNT',blocking:true}],'b').state,'NEEDS_ATTENTION');
});

test('import workspace persists processing state without becoming ledger entities',async()=>{
 const repo=new InMemoryImportWorkspace(),session:ImportSession={id:'s',sourceType:'EXCEL',sourceSystem:'WECHAT',createdAt:'a',updatedAt:'a',state:'PROCESSING',sourceCount:0,committedCount:0,skippedDuplicateCount:0,blockingAttentionCount:0,nonBlockingAttentionCount:0,failureCode:null};
 await repo.putSession(session);assert.deepEqual(await repo.getSession('s'),session);
 await repo.clearSession('s');assert.equal(await repo.getSession('s'),null);
});
