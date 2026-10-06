import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import * as shared from '../cloudbase/capture-src/shared.ts';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {prepareWebCapture,applyWebCapture} from '../apps/web/src/capture-import-flow.ts';
import type {CaptureJob} from '../apps/web/src/capture-jobs.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
const require=createRequire(import.meta.url),{createHandler,ledgerFor}=require('../cloudbase/functions/star-ledger-capture/handler.cjs');
const uid='synthetic-s1',id='capture:test',now=Date.parse('2026-10-06T12:00:00Z');
const bytes=Buffer.from('89504e470d0a1a0a0000','hex'),image=bytes.toString('base64'),contentHash=createHash('sha256').update(bytes).digest('hex');
const raw=(missing=false)=>JSON.stringify({evidence:{platform:'微信',displayAmount:'10.00',status:'支付成功',merchant:'合成商户',paymentMethod:'',fields:[],identifiers:[{role:'交易单号',value:'SYNTHETIC-S1',visible:true}],times:[],moneyLines:[{role:'支出',amount:missing?null:'10.00',time:missing?null:'2026-10-06 12:00:00',status:'支付成功'}],uncertain:[]},candidates:[]});
function harness(options:{raw?:string;fetch?:()=>Promise<any>;uid?:string}={}){
 const tasks=new Map<string,any>(),results=new Map<string,any>();let calls=0;
 const repo={create:async(t:any)=>{if(tasks.has(t.id))return false;tasks.set(t.id,structuredClone(t));return true;},get:async(s:any,i:string)=>{const t=tasks.get(i);return t&&t.userId===s.userId&&t.ledgerId===s.ledgerId?structuredClone(t):null;},replace:async(s:any,i:string,v:number,n:any)=>{const t=await repo.get(s,i);if(t?.version!==v)return false;tasks.set(i,structuredClone(n));return true;},publish:async(s:any,i:string,v:number,n:any,e:any)=>{if(!await repo.replace(s,i,v,n))return false;results.set(e.id,structuredClone(e));return true;},result:async(_s:any,_i:string,r:string)=>results.get(r)??null};
 const fetchImpl=async()=>{calls++;if(options.fetch)return options.fetch();return {ok:true,json:async()=>({choices:[{message:{content:options.raw??raw()},finish_reason:'stop'}],usage:{total_tokens:42}})};};
 const handler=createHandler({repo,shared,getUid:async()=>options.uid??uid,key:'synthetic-not-real',allowedUids:new Set([uid]),fetchImpl,now:()=>now});
 const event=(action:string)=>({action,id,contentHash,sourceSystem:'WECHAT',image,mime:'image/png'});
 return {handler,event,tasks,results,calls:()=>calls};
}
test('server uses official model path, durable result and idempotent repeated analyze without another call',async()=>{
 const h=harness();const first=await h.handler(h.event('analyze'));assert.equal(first.ok,true);assert.equal(first.value.task.state,'READY');assert.ok(first.value.evidence.rawExtraction);
 assert.equal((await h.handler(h.event('analyze'))).ok,true);assert.equal(h.calls(),1);
 assert.equal((await h.handler({...h.event('read'),uid:'another',ledgerId:'other'})).value.task.userId,uid);
 const denied=harness({uid:'not-in-pilot'});assert.equal((await denied.handler(denied.event('analyze'))).error,'CAPTURE_ACCESS_DENIED');assert.equal(denied.calls(),0);
});
test('cancellation while model runs rejects late publish; no evidence or second model call',async()=>{
 let resolveFetch!:(value:any)=>void;const h=harness({fetch:()=>new Promise(r=>{resolveFetch=r;})});const pending=h.handler(h.event('analyze'));
 while(!resolveFetch)await new Promise(r=>setImmediate(r));
 const cancelled=await h.handler(h.event('cancel'));assert.equal(cancelled.value.task.state,'CANCELLED');
 resolveFetch({ok:true,json:async()=>({choices:[{message:{content:raw()},finish_reason:'stop'}]})});await pending;
 assert.equal(h.tasks.get(id).state,'CANCELLED');assert.equal(h.results.size,0);assert.equal(h.calls(),1);
});
test('invalid output and altered image fail without financial results',async()=>{
 const h=harness({raw:'not JSON'});const response=await h.handler(h.event('analyze'));assert.equal(response.ok,false);assert.equal(h.tasks.get(id).state,'RETRYABLE_FAILURE');assert.equal(h.results.size,0);
 const bad=harness();assert.equal((await bad.handler({...bad.event('analyze'),contentHash:'a'.repeat(64)})).error,'CAPTURE_IMAGE_HASH_MISMATCH');assert.equal(bad.calls(),0);
});
async function job(missing=false){const h=harness({raw:raw(missing)}),result=await h.handler(h.event('analyze'));assert.equal(result.ok,true);return {id,uid,ledgerId:ledgerFor(uid),contentHash,sourceSystem:'WECHAT',mime:'image/png',image:new Blob([bytes]),createdAt:now,expiresAt:now+86400000,state:'WAITING',remote:result.value.task,evidence:result.value.evidence} as CaptureJob;}
async function prepare(store:MemoryStore,j:CaptureJob){return prepareWebCapture(store.state,j,{entities:store.entities,conflicts:store.conflicts},new Date(now+1000).toISOString());}
test('Web ledger, source evidence, outcomes and local receipt apply together; repeat is harmless',async()=>{
 const j=await job(),state=fresh();state.captureJobs={[id]:j};const store=new MemoryStore(state),p=await prepare(store,j);
 store.atomic(()=>applyWebCapture(store,id,p,new Date(now+1000).toISOString()));assert.equal(store.state.captureJobs![id].state,'COMPLETED');assert.equal(store.entities.filter(e=>e.type==='transactions').length,1);assert.equal(store.state.captureJobs![id].image,undefined);assert.equal(store.state.captureJobs![id].receipt!.importSessionId,store.state.captureJobs![id].sessionId);
 const count=store.state.ops.length;applyWebCapture(store,id,p,new Date(now+1000).toISOString());assert.equal(store.state.ops.length,count);assert.ok(store.state.importWorkspace?.captureEvidence?.[store.state.captureJobs![id].sessionId!]);
});
test('missing facts remain uncommitted, user supplements same evidence and common import completes',async()=>{
 const j=await job(true),state=fresh();state.captureJobs={[id]:j};const store=new MemoryStore(state),p=await prepare(store,j);applyWebCapture(store,id,p,new Date(now+1000).toISOString());
 assert.equal(store.entities.filter(e=>e.type==='transactions').length,0);assert.equal(store.state.captureJobs![id].state,'NEEDS_INPUT');
 const sid=store.state.captureJobs![id].sessionId!,record=store.state.importWorkspace!.records[sid][0];
 store.state.captureJobs![id].answers={[record.id]:{amountFen:1000,occurredAt:'2026-10-06T04:00:00Z'}};
 const next=await prepare(store,store.state.captureJobs![id]);applyWebCapture(store,id,next,new Date(now+1000).toISOString());
 assert.equal(store.state.captureJobs![id].state,'COMPLETED');assert.equal(store.entities.filter(e=>e.type==='transactions').length,1);assert.equal(store.state.captureJobs![id].evidence!.rawExtraction,j.evidence!.rawExtraction);
});
test('local cancellation and concurrent ledger change fence prepared capture writes',async()=>{
 const j=await job(),state=fresh();state.captureJobs={[id]:j};const store=new MemoryStore(state),p=await prepare(store,j);
 store.state.captureJobs![id].state='CANCELLED';applyWebCapture(store,id,p,new Date(now+1000).toISOString());assert.equal(store.state.ops.length,0);
 store.state.captureJobs![id].state='WAITING';new BusinessAccountingService(store,store.state.device).execute({kind:'CREATE_ACCOUNT',id:'synthetic',name:'合成账户',accountType:'ASSET',openingBalance:null,openingBalanceAt:new Date(now).toISOString()});
 assert.throws(()=>store.atomic(()=>applyWebCapture(store,id,p,new Date(now+1000).toISOString())),/STALE_CAPTURE_IMPORT_PLAN/);assert.equal(store.entities.filter(e=>e.type==='transactions').length,0);
});
