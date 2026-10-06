import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {RemoteCaptureService,type RemoteCaptureRepository} from '../packages/application/remote-capture.ts';
import {changeCaptureTask,newCaptureTask,type CaptureTask} from '../packages/application/capture-task.ts';
import {captureEvidence} from '../packages/importing/capture-evidence.ts';
import type {CaptureEvidence} from '../packages/importing/types.ts';
const {CapturePostgresRepository}=createRequire(import.meta.url)('../cloudbase/functions/star-ledger-capture/postgres.cjs');
const scope={userId:'u',ledgerId:'l'},e=captureEvidence({contentHash:'image',schemaVersion:'experiment-1',promptVersion:'experiment-1',model:'fixture',pageKind:'payment_detail',sourceSystem:'WECHAT',platformRaw:'微信',profile:'本人',rawExtraction:'fixture raw',capturedAt:'2026-10-06T00:00:00Z'});
function analysing(){let t=newCaptureTask(scope,'t','image','capture-request-1',0,1000);t=changeCaptureTask(t,{kind:'START_UPLOAD'},1);t=changeCaptureTask(t,{kind:'ACCEPT',imageRef:'private',remoteTaskId:'remote'},2);return changeCaptureTask(t,{kind:'CLAIM',token:'w',leaseUntil:100},3);}
function fixture(){
 let task:CaptureTask|null=null,result:CaptureEvidence|null=null,published=0;
 const repo:RemoteCaptureRepository={
  async create(next){if(task)return false;task=structuredClone(next);return true;},async get(s,id){return task&&task.userId===s.userId&&task.ledgerId===s.ledgerId&&task.id===id?structuredClone(task):null;},
  async replace(s,id,v,next){if(!task||task.version!==v||task.userId!==s.userId||task.id!==id)return false;task=structuredClone(next);return true;},
  async publish(s,id,v,next,evidence){if(!task||task.version!==v)return false;task=structuredClone(next);result=structuredClone(evidence);published++;return true;},async result(){return result;}
 };
 return {repo,service:new RemoteCaptureService(repo),setTask(t:CaptureTask){task=t;},setResult(r:CaptureEvidence|null){result=r;},get task(){return task;},get published(){return published;}};
}
test('server queues idempotently within verified uid; reused task ID with changed image is rejected',async()=>{
 const f=fixture();await assert.rejects(f.service.queue('','l','t','image',0),/CLOUD_AUTH_REQUIRED/);
 const one=await f.service.queue('u','l','t','image',0);assert.deepEqual(await f.service.queue('u','l','t','image',1),one);
 await assert.rejects(f.service.queue('u','l','t','different',1),/CAPTURE_TASK_ID_COLLISION/);assert.equal(await f.service.read('other','l','t'),null);
});
test('late worker after cancellation cannot publish a result; stale lease and image mismatch fail before storage',async()=>{
 const f=fixture(),t=analysing();f.setTask(t);await f.service.cancel('u','l','t',t.version,4);
 await assert.rejects(f.service.publish(scope,'t',t.version,'w',1,e,5),/CAPTURE_VERSION_CONFLICT/);assert.equal(f.published,0);
 f.setTask(t);await assert.rejects(f.service.publish(scope,'t',t.version,'wrong',1,e,5),/STALE_CAPTURE_WORKER/);
 await assert.rejects(f.service.publish(scope,'t',t.version,'w',1,{...e,contentHash:'different'},5),/CAPTURE_EVIDENCE_ID_MISMATCH/);assert.equal(f.published,0);
});
test('READY retrieval requires durable immutable evidence rather than only a result pointer',async()=>{
 const f=fixture(),t=analysing();f.setTask(t);await f.service.publish(scope,'t',t.version,'w',1,e,4);
 assert.deepEqual((await f.service.read('u','l','t'))!.evidence,e);f.setResult(null);await assert.rejects(f.service.read('u','l','t'),/CAPTURE_DURABLE_RESULT_MISSING/);
});
test('SQL serialization scopes every request and encodes arbitrary text without string interpolation injection',async()=>{
 const queries:{Sql:string;Role:string}[]=[];const dangerous="u'; DROP TABLE anything; --";
 const task=newCaptureTask({userId:dangerous,ledgerId:'l'},'t','image','v1',0,1000);
 const repo=new CapturePostgresRepository(async(q:{Sql:string;Role:string})=>{queries.push(q);return {Columns:['payload'],Rows:[JSON.stringify([JSON.stringify(task)])]};});
 assert.equal(await repo.create(task),true);assert.deepEqual(await repo.get({userId:dangerous,ledgerId:'l'},'t'),task);
 assert.ok(queries.every(q=>q.Role==='service_role'&&!q.Sql.includes(dangerous)));assert.match(queries[1].Sql,/user_id=.* AND ledger_id=.* AND task_id=/);
 await assert.rejects(repo.complete(),/REMOTE_CAPTURE_CANNOT_COMMIT_LOCAL_LEDGER/);
});
test('PG publish uses one version-fenced statement for task and immutable result, transport errors are not successes',async()=>{
 const queries:string[]=[];const task=analysing(),next=changeCaptureTask(task,{kind:'RESULT',token:'w',attempt:1,result:{id:e.id,responseHash:e.responseHash,schemaVersion:e.schemaVersion,promptVersion:e.promptVersion}},4);
 const repo=new CapturePostgresRepository(async(q:{Sql:string})=>{queries.push(q.Sql);return {Columns:['payload'],Rows:[]};});
 assert.equal(await repo.publish(scope,'t',task.version,next,e),false);assert.equal(queries.length,1);assert.match(queries[0],/WITH accepted AS/);assert.match(queries[0],/INSERT INTO public.star_ledger_capture_result/);assert.match(queries[0],/version=3/);
 const broken=new CapturePostgresRepository(async()=>({AffectedRows:1,Rows:null,Columns:null}));await assert.rejects(broken.create(newCaptureTask(scope,'t','image','v1',0,1000)),/INVALID_CAPTURE_SQL_RESULT/);
});
