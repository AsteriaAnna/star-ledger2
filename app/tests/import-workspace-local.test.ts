import test from 'node:test';
import assert from 'node:assert/strict';
import {LocalImportWorkspace,type WorkspaceStorage} from '../packages/importing/workspace.ts';
import type {AttentionItem,ExternalRecord,ImportSession} from '../packages/importing/types.ts';

class MemoryStorage implements WorkspaceStorage {
 data=new Map<string,string>();
 getItem(key:string){return this.data.get(key)??null;}
 setItem(key:string,value:string){this.data.set(key,value);}
 removeItem(key:string){this.data.delete(key);}
}
const session:ImportSession={id:'session-1',sourceType:'EXCEL',sourceSystem:'WECHAT',createdAt:'2026-10-02T10:00:00Z',updatedAt:'2026-10-02T10:00:00Z',state:'NEEDS_ATTENTION',sourceCount:1,committedCount:0,skippedDuplicateCount:0,noEffectCount:0,blockingAttentionCount:1,nonBlockingAttentionCount:0,failureCode:null};
const record:ExternalRecord={id:'record-1',sessionId:'session-1',sourceIdentity:'order-1',sourceType:'EXCEL',sourceSystem:'WECHAT',platformRaw:'微信',profile:'本人',rawPayload:'{}',facts:{occurredAt:'2026-10-01T10:00:00Z',amountFen:1000,transactionTypeRaw:'商户消费',directionRaw:'支出',statusRaw:'支付成功',channelRaw:'零钱',counterpartyRaw:'商户',productRaw:'商品',noteRaw:'',sourceCategoryRaw:'',orderId:'order-1',refundId:null,originalOrderId:null,precision:'second'},parserVersion:2,capturedAt:'2026-10-02T10:00:00Z'};
const attention:AttentionItem={id:'attention-1',sessionId:'session-1',externalRecordId:'record-1',kind:'ACCOUNT',question:'哪个账户？',blocking:true,candidates:[],createdAt:'2026-10-02T10:00:00Z'};

test('local import workspace survives repository restart without entering ledger operations',async()=>{
 const storage=new MemoryStorage(),first=new LocalImportWorkspace(storage);
 await first.saveSessionSnapshot(session,[record],[attention]);
 const second=new LocalImportWorkspace(storage);
 assert.deepEqual(await second.getSession('session-1'),session);
 assert.deepEqual(await second.listExternalRecords('session-1'),[record]);
 assert.deepEqual(await second.listAttentionItems('session-1'),[attention]);
});

test('workspace snapshot ownership fails before persistent state changes',async()=>{
 const storage=new MemoryStorage(),workspace=new LocalImportWorkspace(storage);
 await workspace.saveSessionSnapshot(session,[record],[attention]);const before=[...storage.data.values()][0];
 await assert.rejects(()=>workspace.saveSessionSnapshot({...session,id:'other'},[record],[attention]),/IMPORT_SESSION_MISMATCH/);
 assert.equal([...storage.data.values()][0],before);
});

test('corrupt device-local workspace fails closed and preserves recovery bytes',()=>{
 const storage=new MemoryStorage();storage.setItem('star-ledger:v2:import-workspace','{broken');
 assert.throws(()=>new LocalImportWorkspace(storage),/CORRUPT_IMPORT_WORKSPACE/);
 assert.equal(storage.getItem('star-ledger:v2:import-workspace'),'{broken');
});


test('unfinished sessions can be rediscovered after reload without a second active-session pointer',async()=>{
 const storage=new MemoryStorage(),first=new LocalImportWorkspace(storage);
 await first.saveSessionSnapshot(session,[record],[attention]);
 await first.putSession({...session,id:'older',updatedAt:'2026-10-01T10:00:00Z',sourceCount:0,blockingAttentionCount:0,state:'COMPLETED'});
 const second=new LocalImportWorkspace(storage),sessions=await second.listSessions();
 assert.deepEqual(sessions.map(value=>value.id),['session-1','older']);
 assert.equal(sessions.find(value=>value.state==='NEEDS_ATTENTION')?.id,'session-1');
});
