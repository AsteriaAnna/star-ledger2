import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newCaptureTask,CaptureTaskService,type CaptureAction} from '../packages/application/capture-task.ts';
import {SqliteCaptureTaskRepository} from '../packages/storage/capture-task-store.ts';
const scope={userId:'user-a',ledgerId:'ledger-a'};
const result={id:'source-ref',schemaVersion:'2',promptVersion:'draft-2',responseHash:'test-response-hash'};
const receipt={commitId:'batch-1',importSessionId:'existing-import-session',outcomeRecordIds:['event-1','event-2']};
async function fixture(path=':memory:'){
 const db=new DatabaseSync(path);const repository=new SqliteCaptureTaskRepository(db);const service=new CaptureTaskService(repository);
 let task=newCaptureTask(scope,'capture-1','image-hash','request-1',0,1000);await repository.create(task);
 async function change(action:CaptureAction,now:number){task=await service.change(scope,task.id,task.version,action,now);return task;}
 async function ready(){await change({kind:'START_UPLOAD'},1);await change({kind:'ACCEPT',imageRef:'private-image',remoteTaskId:'remote-1'},2);await change({kind:'CLAIM',token:'analysis-1',leaseUntil:100},3);await change({kind:'RESULT',token:'analysis-1',attempt:1,result},4);}
 return {db,repository,service,change,ready,get task(){return task;}};
}
test('durable reload retains accepted task/result; scope isolates task IDs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capture-task-'));const path=join(dir,'task.db');let db:DatabaseSync|undefined;
 try{
  const f=await fixture(path);await f.ready();f.db.close();db=new DatabaseSync(path);const r=new SqliteCaptureTaskRepository(db);
  const recovered=await r.get(scope,'capture-1');assert.equal(recovered?.state,'READY');assert.deepEqual(recovered?.result,result);
  assert.equal(await r.get({...scope,userId:'user-b'},'capture-1'),null);
  assert.equal(await r.get({...scope,ledgerId:'ledger-b'},'capture-1'),null);
  const own=newCaptureTask({...scope,userId:'user-b'},'capture-1','same-hash','v1',0,1000);assert.equal(await r.create(own),true);
  assert.equal(await r.create({...own,contentHash:'different'}),false);
  assert.equal((await r.list(scope)).length,1);assert.equal((await r.list({...scope,userId:'user-c'})).length,0);
 }finally{db?.close();rmSync(dir,{recursive:true,force:true});}
});
test('two worker claims only grant one lease through compare-and-swap',async()=>{
 const f=await fixture();try{
  await f.change({kind:'START_UPLOAD'},1);await f.change({kind:'ACCEPT',imageRef:'image',remoteTaskId:'remote'},2);
  const claims=await Promise.allSettled(['w1','w2'].map(token=>f.service.change(scope,'capture-1',2,{kind:'CLAIM',token,leaseUntil:100},3)));
  assert.equal(claims.filter(c=>c.status==='fulfilled').length,1);assert.equal((await f.repository.get(scope,'capture-1'))?.attempt,1);
 }finally{f.db.close();}
});
test('unknown upload reconciles acceptance instead of being retried',async()=>{
 const f=await fixture();try{
  await f.change({kind:'START_UPLOAD'},1);await f.change({kind:'FAIL',certainty:'UNKNOWN'},2);
  await assert.rejects(()=>f.change({kind:'RETRY',automatic:true},3),/INVALID_CAPTURE_TRANSITION/);
  await f.change({kind:'ACCEPT',imageRef:'already-uploaded',remoteTaskId:'already-accepted'},3);assert.equal(f.task.state,'ACCEPTED');
 }finally{f.db.close();}
});
test('lease timeout requires reconciliation; old response is fenced out',async()=>{
 const f=await fixture();try{
  await f.change({kind:'START_UPLOAD'},1);await f.change({kind:'ACCEPT',imageRef:'image',remoteTaskId:'remote'},2);
  await f.change({kind:'CLAIM',token:'old',leaseUntil:10},3);const oldVersion=f.task.version;
  await f.change({kind:'RECOVER_LEASE'},10);assert.equal(f.task.state,'RECONCILING');
  await assert.rejects(()=>f.change({kind:'CLAIM',token:'new',leaseUntil:100},11),/INVALID_CAPTURE_TRANSITION/);
  await f.change({kind:'RECONCILE',resolution:'SAFE_TO_RETRY'},11);await f.change({kind:'RETRY',automatic:true},12);
  await f.change({kind:'CLAIM',token:'new',leaseUntil:100},13);
  await assert.rejects(()=>f.service.change(scope,'capture-1',oldVersion,{kind:'RESULT',token:'old',attempt:1,result},14),/CAPTURE_VERSION_CONFLICT/);
  await assert.rejects(()=>f.change({kind:'RESULT',token:'old',attempt:1,result},14),/STALE_CAPTURE_WORKER/);
  await f.change({kind:'FAIL',certainty:'SAFE_TO_RETRY',token:'new',attempt:2},14);
  await assert.rejects(()=>f.change({kind:'RETRY',automatic:true},15),/CAPTURE_RETRY_LIMIT/);
  await f.change({kind:'RETRY',automatic:false},15);assert.equal(f.task.automaticRetries,1);
 }finally{f.db.close();}
});
test('cancel during analysis rejects late response; cleanup keeps audit metadata',async()=>{
 const f=await fixture();try{
  await f.change({kind:'START_UPLOAD'},1);await f.change({kind:'ACCEPT',imageRef:'image',remoteTaskId:'remote'},2);
  await f.change({kind:'CLAIM',token:'worker',leaseUntil:100},3);await f.change({kind:'CANCEL'},4);
  await assert.rejects(()=>f.change({kind:'RESULT',token:'worker',attempt:1,result},5),/CAPTURE_TASK_TERMINAL/);
  await f.change({kind:'CLEANED'},5);assert.equal(f.task.imageRef,null);assert.equal(f.task.cleanup,'DONE');assert.equal(f.task.contentHash,'image-hash');
 }finally{f.db.close();}
});
test('cancel wins before atomic completion; losing commit never calls ledger writer',async()=>{
 const f=await fixture();try{
  await f.ready();await f.change({kind:'BEGIN_COMMIT',token:'commit',leaseUntil:100},5);const version=f.task.version;
  await f.change({kind:'CANCEL'},6);let called=false;
  await assert.rejects(()=>f.service.complete(scope,'capture-1',version,'commit',receipt,7,()=>{called=true;}),/CAPTURE_VERSION_CONFLICT/);
  assert.equal(called,false);
 }finally{f.db.close();}
});
test('ledger, import outcomes and completion roll back together, then retry exactly once',async()=>{
 const f=await fixture();try{
  f.db.exec('CREATE TABLE test_ledger(id TEXT PRIMARY KEY); CREATE TABLE test_outcome(id TEXT PRIMARY KEY)');
  await f.ready();await f.change({kind:'BEGIN_COMMIT',token:'commit',leaseUntil:100},5);const version=f.task.version;
  await assert.rejects(()=>f.service.complete(scope,'capture-1',version,'commit',receipt,6,()=>{f.db.exec("INSERT INTO test_ledger VALUES('transaction-1')");throw Error('OUTCOME_STORAGE_FAILED');}),/OUTCOME_STORAGE_FAILED/);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM test_ledger').get()?.n,0);
  assert.equal((await f.repository.get(scope,'capture-1'))?.state,'COMMITTING');
  const completed=await f.service.complete(scope,'capture-1',version,'commit',receipt,7,()=>{f.db.exec("INSERT INTO test_ledger VALUES('transaction-1'); INSERT INTO test_outcome VALUES('event-1')");});
  assert.equal(completed.state,'COMPLETED');assert.deepEqual(completed.receipt,receipt);
  await assert.rejects(()=>f.service.complete(scope,'capture-1',version,'commit',receipt,8,()=>{throw Error('SHOULD_NOT_CALL');}),/CAPTURE_VERSION_CONFLICT/);
  await assert.rejects(()=>f.service.change(scope,'capture-1',completed.version,{kind:'CANCEL'},8),/CAPTURE_TASK_TERMINAL/);
  const cleaned=await f.service.change(scope,'capture-1',completed.version,{kind:'CLEANED'},8);assert.equal(cleaned.imageRef,null);assert.deepEqual(cleaned.receipt,receipt);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM test_ledger').get()?.n,1);
 }finally{f.db.close();}
});
test('expiry preserves result facts; human input does not need a new AI attempt',async()=>{
 const f=await fixture();try{
  await f.ready();await f.change({kind:'NEEDS_INPUT'},5);await f.change({kind:'RESUME'},6);assert.equal(f.task.attempt,1);
  await assert.rejects(()=>f.change({kind:'EXPIRE'},7),/CAPTURE_NOT_EXPIRED/);
  await f.change({kind:'EXPIRE'},1000);assert.equal(f.task.state,'EXPIRED');assert.deepEqual(f.task.result,result);
  await f.change({kind:'CLEANED'},1001);assert.deepEqual(f.task.result,result);
 }finally{f.db.close();}
});
test('active commit lease prevents takeover; expired atomic commit can safely resume',async()=>{
 const f=await fixture();try{
  await f.ready();await f.change({kind:'BEGIN_COMMIT',token:'commit',leaseUntil:10},5);
  await assert.rejects(()=>f.change({kind:'RECOVER_LEASE'},6),/CAPTURE_LEASE_ACTIVE/);
  await f.change({kind:'RECOVER_LEASE'},10);assert.equal(f.task.state,'READY');assert.deepEqual(f.task.result,result);
 }finally{f.db.close();}
});
test('an async ledger writer is rejected before any ledger callback runs',async()=>{
 const f=await fixture();try{
  await f.ready();await f.change({kind:'BEGIN_COMMIT',token:'commit',leaseUntil:100},5);let called=false;
  await assert.rejects(()=>f.service.complete(scope,'capture-1',f.task.version,'commit',receipt,6,async()=>{called=true;}),/CAPTURE_ASYNC_COMMIT_FORBIDDEN/);
  assert.equal(called,false);assert.equal((await f.repository.get(scope,'capture-1'))?.state,'COMMITTING');
 }finally{f.db.close();}
});
