import test from 'node:test';
import assert from 'node:assert/strict';
import {validateImportWorkspace} from '../apps/web/src/store.ts';

const session={id:'s',sourceType:'EXCEL',sourceSystem:'WECHAT',createdAt:'2026-10-02T10:00:00Z',updatedAt:'2026-10-02T10:00:00Z',state:'NEEDS_ATTENTION',sourceCount:1,committedCount:0,skippedDuplicateCount:0,noEffectCount:0,blockingAttentionCount:1,nonBlockingAttentionCount:0,failureCode:null};
const record={id:'r',sessionId:'s',sourceIdentity:'order',sourceType:'EXCEL',sourceSystem:'WECHAT',platformRaw:'微信',profile:'本人',rawPayload:'{}',facts:{},parserVersion:3,capturedAt:'2026-10-02T10:00:00Z'};
const attention={id:'a',sessionId:'s',externalRecordId:'r',kind:'ACCOUNT',question:'哪个账户？',blocking:true,candidates:[],createdAt:'2026-10-02T10:00:00Z'};

test('manual backup workspace validation preserves a recoverable pending import',()=>{
 const value={sessions:{s:session},records:{s:[record]},attention:{s:[attention]}};
 assert.deepEqual(validateImportWorkspace(value),{...value,outcomes:{}});
});

test('backup restore rejects workspace rows assigned to another session',()=>{
 assert.throws(()=>validateImportWorkspace({sessions:{s:session},records:{s:[{...record,sessionId:'other'}]},attention:{s:[attention]}}),/备份导入恢复状态格式无效/);
});

test('backup restore accepts every frozen ImportSession lifecycle state',()=>{
 for(const state of ['PROCESSING','NEEDS_ATTENTION','COMPLETED','FAILED','ROLLED_BACK']){
  assert.equal(validateImportWorkspace({sessions:{s:{...session,state}},records:{s:[]},attention:{s:[]}}).sessions.s.state,state);
 }
});
