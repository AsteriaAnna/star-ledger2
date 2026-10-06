import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureEvidence,captureEventRecords,type CaptureObservation} from '../packages/importing/capture-evidence.ts';
import {readPersistedCaptureEvidence} from '../packages/importing/persisted-capture-evidence.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {planImportCommit} from '../packages/application/import-commit.ts';
import {planImportExecution} from '../packages/application/import-execution.ts';
import {planResumeImport} from '../packages/application/import-resume.ts';
import {importedSourceEvidence,importSourcePayload} from '../packages/application/import-ledger-intent.ts';
import {planImportSourceAnswer,sourceReviewContext} from '../packages/application/import-source-attention.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {SqliteStore} from '../packages/storage/index.ts';
import {project} from '../packages/sync/projection.ts';
import {FakeSyncProvider,PortableSyncEngine} from '../packages/sync/core.ts';
import {MemoryStore,fresh,hash} from '../apps/web/src/store.ts';
import type {CaptureEvidence,EventInterpretation} from '../packages/importing/types.ts';
import type {Entity} from '../packages/domain/index.ts';
const at='2026-01-01T04:00:00Z';
const evidence=(rawExtraction='synthetic original 79.59; refunds .26 and .44')=>captureEvidence({contentHash:'image-fixture',schemaVersion:'2',promptVersion:'draft-2',model:'fixture',pageKind:'payment_detail',sourceSystem:'WECHAT',platformRaw:'微信',profile:'本人',rawExtraction,capturedAt:at});
const observation=(key:string,amountFen:number,sourceClass:'payment'|'refund'):CaptureObservation=>({role:'EVENT',key,region:key,ordinal:0,sourceClass,facts:{occurredAt:at,amountFen,transactionTypeRaw:sourceClass==='refund'?'退款':'消费',directionRaw:sourceClass==='refund'?'收入':'支出',statusRaw:'支付成功',channelRaw:'零钱',counterpartyRaw:'测试商户',productRaw:'商品',noteRaw:'',sourceCategoryRaw:'',orderId:'P',refundId:sourceClass==='refund'?key:null,originalOrderId:null,precision:'second'}});
async function prepare(e:CaptureEvidence,workspace=new InMemoryImportWorkspace(),ledger={entities:[] as Entity[],conflicts:[]},sessionId='s'){
 const records=captureEventRecords(e,sessionId,[observation('p',7959,'payment'),observation('r-a',26,'refund'),observation('r-b',44,'refund')],4);
 const interpretations:EventInterpretation[]=records.map(r=>({externalRecordId:r.id,eventKind:r.capture!.sourceClass==='payment'?'PURCHASE':'REFUND',status:'SUCCESS',amountFen:r.facts.amountFen,occurredAt:at,displayName:'测试',channelRaw:'零钱',categorySuggestion:'购物',evidence:[]}));
 const service=new ImportStatementService(workspace),prepared=await service.prepare({sessionId,sourceType:'SCREENSHOT',sourceSystem:'WECHAT',records,interpretations,captureEvidence:[e],ledger,now:at});
 const resolved=await service.resolve({prepared,records,ledger,now:at});
 const plan=planImportCommit(resolved,records),execution=planImportExecution(plan,ledger,at);
 return {workspace,records,resolved,execution};
}
test('formal SQLite ledger retains one logical capture and three event references after workspace clear and reopen',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'star-capture-')),path=join(directory,'ledger.sqlite');
 let store=new SqliteStore(path,'a');t.after(()=>{store.close();rmSync(directory,{recursive:true,force:true});});
 const e=evidence(),p=await prepare(e);new BusinessAccountingService(store,'a').executeBatch(p.execution.commands);
 await p.workspace.clearSession('s');assert.equal((await p.workspace.listCaptureEvidence('s')).length,0);
 store.close();store=new SqliteStore(path,'a');const entities=project(store.allOperations()).entities,recovered=readPersistedCaptureEvidence(entities);
 assert.deepEqual(recovered.evidence,[e]);assert.equal(recovered.references.length,3);assert.deepEqual(recovered.missingEvidenceSourceIds,[]);
 assert.equal(entities.filter(e=>e.type==='transactions').length,3);
 assert.equal(entities.filter(e=>e.type==='consumption_effects').reduce((sum,e)=>sum+Number(e.fields.amount),0),7889);
 assert.equal(entities.filter(e=>e.type==='balance_movements').reduce((sum,e)=>sum+Number(e.fields.amount),0),-7889);
});
test('Web operation backup and portable batch restore recover evidence with no workspace',async()=>{
 const e=evidence(),p=await prepare(e),store=new MemoryStore(fresh());new BusinessAccountingService(store,store.state.device).executeBatch(p.execution.commands);
 const backup=JSON.parse(JSON.stringify({operations:store.allOperations()}));const restored=new MemoryStore({...fresh(),ops:backup.operations});
 assert.deepEqual(readPersistedCaptureEvidence(restored.entities).evidence,[e]);
 const remote=new FakeSyncProvider(),sender=new PortableSyncEngine(store,remote,hash);sender.upload();
 const receiver=new MemoryStore(fresh());new PortableSyncEngine(receiver,remote,hash).download();
 assert.deepEqual(readPersistedCaptureEvidence(receiver.entities),readPersistedCaptureEvidence(store.entities));
});
test('missing evidence cannot reach a new capture commit; Excel source payload remains version 3 without capture fields',async()=>{
 const p=await prepare(evidence());
 assert.throws(()=>importSourcePayload(p.records[0]),/INVALID_CAPTURE_REFERENCE/);
 assert.throws(()=>planImportCommit({...p.resolved,captureEvidence:[]},p.records),/INVALID_CAPTURE_REFERENCE/);
 const legacy={...p.records[0],capture:undefined,sourceType:'EXCEL' as const,rawPayload:'legacy row'};
 const payload=JSON.parse(importSourcePayload(legacy));assert.equal(payload.version,3);assert.equal(Object.hasOwn(payload,'captureEvidence'),false);
});
test('tampered capture batch rolls back Web and SQLite writes including outbox',async t=>{
 const p=await prepare(evidence()),bad=structuredClone(p.execution.commands);const command=bad.find(c=>'source' in c&&c.source)!;
 if(!('source' in command)||!command.source)throw Error('MISSING_SOURCE');
 const payload=JSON.parse(command.source.rawPayload);payload.captureEvidence.rawExtraction='tampered';command.source.rawPayload=JSON.stringify(payload);
 const web=new MemoryStore(fresh()),before=structuredClone(web.state);
 assert.throws(()=>new BusinessAccountingService(web,web.state.device).executeBatch(bad),/CAPTURE_EXTRACTION_HASH_MISMATCH/);assert.deepEqual(web.state,before);
 const sqlite=new SqliteStore(':memory:','a');t.after(()=>sqlite.close());
 assert.throws(()=>new BusinessAccountingService(sqlite,'a').executeBatch(bad),/CAPTURE_EXTRACTION_HASH_MISMATCH/);
 assert.deepEqual(sqlite.allOperations(),[]);assert.deepEqual(sqlite.pendingOperations(),[]);assert.equal(sqlite.get('transactions',p.execution.createdIds[0]),undefined);
});
test('persisted malformed or conflicting references fail validation; historical reference-only sources report gaps',async()=>{
 const p=await prepare(evidence()),source=importedSourceEvidence(p.records[0],p.resolved.captureEvidence);
 const entity:Entity={type:'source_records',id:source.id,fields:{transaction_id:'t',source_type:source.sourceType,platform:source.platform,raw_payload:source.rawPayload,created_at:at}};
 const bad=(edit:(v:any)=>void)=>{const clone=structuredClone(entity),payload=JSON.parse(String(clone.fields.raw_payload));edit(payload);clone.fields.raw_payload=JSON.stringify(payload);return clone;};
 assert.throws(()=>readPersistedCaptureEvidence([bad(v=>delete v.captureEvidence)]),/INVALID_PERSISTED_CAPTURE_EVIDENCE/);
 assert.throws(()=>readPersistedCaptureEvidence([bad(v=>v.capture.evidenceId='wrong')]),/INVALID_CAPTURE_REFERENCE/);
 assert.throws(()=>readPersistedCaptureEvidence([bad(v=>v.capture.region='wrong')]),/INVALID_PERSISTED_CAPTURE_OBSERVATION/);
 assert.throws(()=>readPersistedCaptureEvidence([entity,bad(v=>v.captureEvidence.capturedAt='2026-02-01T00:00:00Z')]),/CAPTURE_EVIDENCE_IMMUTABLE/);
 const legacy=bad(v=>{delete v.captureEvidence;delete v.captureEvidenceVersion;});
 assert.deepEqual(readPersistedCaptureEvidence([legacy]).missingEvidenceSourceIds,[source.id]);
 assert.deepEqual(readPersistedCaptureEvidence([{...entity,fields:{...entity.fields,raw_payload:'old unstructured source'}}]).evidence,[]);
});
test('existing resume path carries capture evidence into final ledger plan without rerunning recognition',async()=>{
 const e=evidence(),p=await prepare(e),snapshot=p.workspace.snapshot();snapshot.sessions.s.state='FAILED';
 const resumed=await planResumeImport('s',snapshot,{entities:[],conflicts:[]},at),store=new MemoryStore(fresh());
 new BusinessAccountingService(store,store.state.device).executeBatch(resumed.execution.commands);
 assert.deepEqual(readPersistedCaptureEvidence(store.entities).evidence,[e]);assert.equal(resumed.workspace.outcomes.s.filter(o=>o.state==='COMMITTED').length,3);
});
test('source review keeps old capture versions and user facts when choosing keep or apply',async()=>{
 for(const mode of ['KEEP_EXISTING','APPLY_SOURCE'] as const){
  const first=await prepare(evidence()),store=new MemoryStore(fresh());new BusinessAccountingService(store,store.state.device).executeBatch(first.execution.commands);
  const second=await prepare(evidence('new extraction version'),first.workspace,{entities:store.entities,conflicts:[]},'changed');
  new BusinessAccountingService(store,store.state.device).executeBatch(second.execution.commands);
  const workspace=second.workspace.snapshot(),attention=workspace.attention.changed.find(a=>a.kind==='SOURCE_UPDATE')!;
  assert.ok(attention);const ledger={entities:store.entities,conflicts:store.conflicts},context=sourceReviewContext('changed',attention.id,workspace,ledger);
  const answer=await planImportSourceAnswer({sessionId:'changed',attentionId:attention.id,mode,expectedToken:context.token,now:at},workspace,ledger);
  new AccountingService(store,store.state.device).execute(answer.commands);
  const recovered=readPersistedCaptureEvidence(store.entities);assert.equal(recovered.evidence.length,2);assert.equal(store.entities.filter(e=>e.type==='transactions').length,3);
  assert.equal(store.entities.filter(e=>e.type==='consumption_effects').reduce((sum,e)=>sum+Number(e.fields.amount),0),7889);
 }
});
