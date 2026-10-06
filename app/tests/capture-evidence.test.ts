import test from 'node:test';
import assert from 'node:assert/strict';
import {captureEvidence,captureEventRecords,type CaptureObservation} from '../packages/importing/capture-evidence.ts';
import {strongSourceEventIdentity} from '../packages/importing/source-event-identity.ts';
import {parseRows} from '../apps/web/src/importer.ts';
import {InMemoryImportWorkspace,LocalImportWorkspace,type WorkspaceStorage} from '../packages/importing/workspace.ts';
import {validateImportWorkspace} from '../apps/web/src/store.ts';
import {findSourceMatch} from '../packages/importing/dedup.ts';
import {importSourcePayload} from '../packages/application/import-ledger-intent.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {importRecordOutcomes,type ImportExecutionPlan} from '../packages/application/import-execution.ts';
import type {CaptureEvidence,EventInterpretation,ImportSession,NormalizedSourceFacts} from '../packages/importing/types.ts';
import type {Entity} from '../packages/domain/index.ts';
const at='2026-01-01T04:00:00Z';
const evidence=(rawExtraction='synthetic extraction',contentHash='image-hash')=>captureEvidence({contentHash,schemaVersion:'2',promptVersion:'draft-2',model:'fixture',pageKind:'payment_detail',sourceSystem:'WECHAT',platformRaw:'微信',profile:'本人',rawExtraction,capturedAt:at});
const facts=(amountFen:number,orderId:string|null=null,refundId:string|null=null):NormalizedSourceFacts=>({occurredAt:at,amountFen,transactionTypeRaw:refundId?'退款':'消费',directionRaw:refundId?'收入':'支出',statusRaw:'支付成功',channelRaw:'零钱',counterpartyRaw:'测试商户',productRaw:'商品',noteRaw:'',sourceCategoryRaw:'',orderId,refundId,originalOrderId:null,precision:'second'});
const observation=(key:string,amount:number,sourceClass:'payment'|'refund',orderId:string|null=null,refundId:string|null=null):CaptureObservation=>({role:'EVENT',key,region:key,ordinal:0,sourceClass,facts:facts(amount,orderId,refundId)});
const multiple=()=>[observation('payment',7959,'payment','PAY-14'),observation('refund-a',26,'refund','PAY-14'),observation('refund-b',44,'refund','PAY-14')];
const session:ImportSession={id:'s',sourceType:'SCREENSHOT',sourceSystem:'WECHAT',createdAt:at,updatedAt:at,state:'PROCESSING',sourceCount:3,committedCount:0,skippedDuplicateCount:0,noEffectCount:0,blockingAttentionCount:0,nonBlockingAttentionCount:0,failureCode:null};
class Storage implements WorkspaceStorage {
 data=new Map<string,string>();fail=false;
 getItem(key:string){return this.data.get(key)??null;}
 setItem(key:string,value:string){if(this.fail)throw Error('QUOTA');this.data.set(key,value);}
 removeItem(key:string){this.data.delete(key);}
}
test('one extraction yields payment and two distinct refund observations; summary is not an event',()=>{
 const e=evidence();const summary={...observation('summary',70,'refund'),role:'SUMMARY' as const};
 const records=captureEventRecords(e,'s',[...multiple(),summary],4);
 assert.deepEqual(records.map(r=>r.facts.amountFen),[7959,26,44]);assert.equal(new Set(records.map(r=>r.sourceIdentity)).size,3);
 assert.equal(new Set(records.map(r=>r.capture!.evidenceId)).size,1);
 assert.equal(records[1].facts.orderId,null);assert.equal(records[1].facts.originalOrderId,'PAY-14');assert.equal(records[1].capture?.identityStrength,'OBSERVATION');
});
test('known event key is byte-compatible with existing Excel parser for payment/refund',()=>{
 const rows=[['微信支付账单明细'],['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号','退款单号'],['2026-01-01 12:00:00','商户消费','商户','商品','支出','79.59','零钱','支付成功','PAY-14',''],['2026-01-01 12:00:00','商户退款','商户','退款','收入','0.26','零钱','退款成功','PAY-14','REFUND-14']];
 const excel=parseRows(rows);const captures=captureEventRecords(evidence(),'s',[observation('p',7959,'payment','PAY-14'),observation('r',26,'refund','PAY-14','REFUND-14')],4);
 assert.equal(captures[0].sourceIdentity,excel[0].identity);assert.equal(captures[1].sourceIdentity,excel[1].identity);
 assert.notEqual(captures[0].sourceIdentity,captures[1].sourceIdentity);
});
test('refund detail original order is relational only; missing own ID never becomes strong',()=>{
 const r=captureEventRecords(evidence(),'s',[observation('r',722,'refund','PAY-05')],4)[0];
 assert.equal(r.capture?.identityStrength,'OBSERVATION');assert.equal(r.facts.orderId,null);assert.equal(r.facts.originalOrderId,'PAY-05');
 assert.notEqual(r.sourceIdentity,strongSourceEventIdentity('微信','本人','refund','PAY-05'));
 const changed=captureEventRecords(evidence('new parser output'),'s',[observation('r',722,'refund','PAY-05')],4)[0];
 assert.equal(changed.capture?.observationId,r.capture?.observationId);assert.equal(changed.sourceIdentity,r.sourceIdentity);
});
test('no-own-ID observations in different screenshots do not become a cross-image strong key',()=>{
 const a=captureEventRecords(evidence('a','image-a'),'s',[observation('r',26,'refund','P')],4)[0];
 const b=captureEventRecords(evidence('b','image-b'),'s',[observation('r',26,'refund','P')],4)[0];assert.notEqual(a.sourceIdentity,b.sourceIdentity);
});
test('legacy order fallback cannot merge new capture refund into original purchase',()=>{
 const entities:Entity[]=[{type:'transactions',id:'purchase',fields:{deleted_at:null,purged_at:null}},{type:'source_records',id:'old-source',fields:{transaction_id:'purchase',platform:'微信',raw_payload:JSON.stringify({order:'P',profile:'本人'})}}];
 assert.deepEqual(findSourceMatch({value:'new-refund',platform:'微信',profile:'本人',orderId:'P',captureEventClass:'refund'},entities).transactionIds,[]);
 assert.deepEqual(findSourceMatch({value:'legacy',platform:'微信',profile:'本人',orderId:'P'},entities).transactionIds,['purchase']);
});
test('shared evidence and separate outcomes survive local reload and backup validation',async()=>{
 const e=evidence(),records=captureEventRecords(e,'s',multiple(),4),storage=new Storage();const first=new LocalImportWorkspace(storage);
 await first.saveSessionSnapshot(session,records,[],undefined,[e]);
 const second=new LocalImportWorkspace(storage);assert.equal((await second.listCaptureEvidence('s')).length,1);assert.equal((await second.listExternalRecords('s')).length,3);
 const plan:ImportExecutionPlan={commands:[],createdIds:['payment','refund-a','refund-b'],createdRecordIds:records.map(r=>r.id),revivedIds:[],revivedRecordIds:[],skippedDuplicateIds:[],noEffectRecordIds:[],blockedRecordIds:[]};
 await second.replaceOutcomes('s',importRecordOutcomes('s',plan,at));
 const snapshot=JSON.parse([...storage.data.values()][0]);const backup=validateImportWorkspace(snapshot);
 assert.equal(backup.outcomes.s.length,3);assert.deepEqual(backup.captureEvidence?.s,[e]);
 const restored=new InMemoryImportWorkspace(backup);assert.equal((await restored.listCaptureEvidence('s'))[0].rawExtraction,'synthetic extraction');
});
test('snapshot rejects missing/mismatched evidence before changing durable or in-memory state',async()=>{
 const e=evidence(),records=captureEventRecords(e,'s',multiple(),4),storage=new Storage(),workspace=new LocalImportWorkspace(storage);
 await assert.rejects(()=>workspace.saveSessionSnapshot(session,records,[]),/INVALID_CAPTURE_REFERENCE/);assert.equal(storage.data.size,0);assert.equal(await workspace.getSession('s'),null);
 await workspace.saveSessionSnapshot(session,records,[],undefined,[e]);const before=[...storage.data.values()][0];
 storage.fail=true;await assert.rejects(()=>workspace.saveSessionSnapshot({...session,updatedAt:'2026-02-01T00:00:00Z'},records,[]),/QUOTA/);
 assert.equal([...storage.data.values()][0],before);assert.equal((await workspace.getSession('s'))?.updatedAt,at);
 assert.throws(()=>validateImportWorkspace({...JSON.parse(before),captureEvidence:{s:[]}}),/INVALID_CAPTURE_REFERENCE/);
});
test('immutable evidence versions cannot be overwritten or silently changed',async()=>{
 const e=evidence(),records=captureEventRecords(e,'s',multiple(),4),workspace=new InMemoryImportWorkspace();await workspace.saveSessionSnapshot(session,records,[],undefined,[e]);
 await assert.rejects(()=>workspace.saveSessionSnapshot(session,records,[],undefined,[{...e,capturedAt:'2026-02-01T00:00:00Z'}]),/CAPTURE_EVIDENCE_IMMUTABLE/);
 assert.deepEqual(await workspace.listCaptureEvidence('s'),[e]);
 await assert.rejects(()=>workspace.saveSessionSnapshot(session,records,[],undefined,[{...e,rawExtraction:'tampered'}]),/CAPTURE_EXTRACTION_HASH_MISMATCH/);
});
test('ledger screenshots, duplicate event identities and conflicting parent IDs are not accepted as original event input',()=>{
 const base=evidence();const ledger=captureEvidence({...base,pageKind:'ledger_record'});
 assert.throws(()=>captureEventRecords(ledger,'s',multiple(),4),/CAPTURE_NOT_PAYMENT_EVIDENCE/);
 assert.throws(()=>captureEventRecords(base,'s',[observation('a',10,'refund','P','R'),observation('b',10,'refund','P','R')],4),/DUPLICATE_CAPTURE_EVENT_IDENTITY/);
 assert.throws(()=>captureEventRecords(base,'s',[{...observation('a',10,'refund','P','R'),facts:{...facts(10,'P','R'),originalOrderId:'OTHER'}}],4),/CAPTURE_ORIGINAL_ORDER_CONFLICT/);
});
test('existing preparation persists container without collapsing event records or changing ledger',async()=>{
 const e=evidence(),records=captureEventRecords(e,'s',multiple(),4),workspace=new InMemoryImportWorkspace();
 const service=new ImportStatementService(workspace,{findAccountMapping:async()=>null,rememberAccountMapping:async()=>{},findMerchantCategory:async()=>null,rememberMerchantCategory:async()=>{}});
 const interpretations:EventInterpretation[]=records.map((r,i)=>({externalRecordId:r.id,eventKind:i===0?'PURCHASE':'REFUND',status:'SUCCESS',amountFen:r.facts.amountFen,occurredAt:at,displayName:'测试',channelRaw:'零钱',categorySuggestion:null,evidence:[]}));
 const ledger={entities:[],conflicts:[]};const prepared=await service.prepare({sessionId:'s',sourceType:'SCREENSHOT',sourceSystem:'WECHAT',records,interpretations,captureEvidence:[e],ledger,now:at});
 assert.equal(prepared.records.length,3);assert.deepEqual(ledger.entities,[]);assert.equal((await workspace.listCaptureEvidence('s')).length,1);
 const payload=JSON.parse(importSourcePayload(records[1]));assert.equal(payload.capture.evidenceId,e.id);assert.equal(payload.originalOrder,'PAY-14');assert.equal(payload.order,null);
});
