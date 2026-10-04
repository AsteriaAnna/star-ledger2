import test from 'node:test';
import assert from 'node:assert/strict';
import type {Entity} from '../packages/domain/index.ts';
import {findSourceMatch} from '../packages/importing/dedup.ts';

const tx=(id:string):Entity=>({type:'transactions',id,fields:{event_type:'PURCHASE',status:'SUCCESS',occurred_at:'2026-09-01T00:00:00Z',display_amount:1000,display_name:id,note:'',created_at:'2026-09-01T00:00:00Z',deleted_at:null}});
const source=(id:string,transactionId:string,platform:string,identity:string,profile?:string):Entity=>({type:'source_records',id,fields:{transaction_id:transactionId,source_type:'EXCEL',platform,raw_payload:JSON.stringify({identity,profile,order:identity}),created_at:'2026-09-01T00:00:00Z'}});

test('source identity matches the same platform and profile only',()=>{
 const entities=[tx('mine'),tx('other'),source('s1','mine','支付宝','same','本人'),source('s2','other','支付宝','same','另一个账本身份')];
 assert.deepEqual(findSourceMatch({value:'same',platform:'支付宝',profile:'本人',orderId:'same'},entities).activeTransactionIds,['mine']);
 assert.deepEqual(findSourceMatch({value:'same',platform:'支付宝',profile:'另一个账本身份',orderId:'same'},entities).activeTransactionIds,['other']);
});
test('same raw identity on another platform is different source evidence',()=>{
 const entities=[tx('ali'),source('s1','ali','支付宝','same','本人')];
 assert.deepEqual(findSourceMatch({value:'same',platform:'微信',profile:'本人',orderId:null},entities).activeTransactionIds,[]);
});
test('legacy source payload without profile remains compatible only with default profile',()=>{
 const entities=[tx('legacy'),source('source-same','legacy','支付宝','same')];
 assert.deepEqual(findSourceMatch({value:'same',platform:'支付宝',profile:'本人',orderId:'same'},entities).activeTransactionIds,['legacy']);
 assert.deepEqual(findSourceMatch({value:'same',platform:'支付宝',profile:'另一个账本身份',orderId:'same'},entities).activeTransactionIds,[]);
});


test('same SourceIdentity distinguishes exact replay from a changed immutable evidence snapshot',()=>{
 const evolving:Entity={type:'source_records',id:'e1',fields:{transaction_id:'tx',source_type:'EXCEL',platform:'微信',raw_payload:JSON.stringify({version:3,identity:'order-1',profile:'本人',order:'order-1',original:'raw-v1'}),created_at:'2026-09-01T00:00:00Z'}};
 const entities=[tx('tx'),evolving];
 const exact=findSourceMatch({value:'order-1',platform:'微信',profile:'本人',orderId:'order-1',rawPayload:'raw-v1'},entities);
 assert.deepEqual(exact.exactEvidenceTransactionIds,['tx']);assert.deepEqual(exact.changedEvidenceTransactionIds,[]);
 const changed=findSourceMatch({value:'order-1',platform:'微信',profile:'本人',orderId:'order-1',rawPayload:'raw-v2'},entities);
 assert.deepEqual(changed.exactEvidenceTransactionIds,[]);assert.deepEqual(changed.changedEvidenceTransactionIds,['tx']);
});
