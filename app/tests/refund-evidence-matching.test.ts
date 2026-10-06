import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {captureEvidence,captureEventRecords,type CaptureObservation} from '../packages/importing/capture-evidence.ts';
import {planRefundEvidenceMatches} from '../packages/importing/refund-evidence-matching.ts';
import {strongSourceEventIdentity} from '../packages/importing/source-event-identity.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {planImportCommit} from '../packages/application/import-commit.ts';
import {planImportExecution} from '../packages/application/import-execution.ts';
import {BusinessAccountingService,correctionSnapshot} from '../packages/accounting/business.ts';
import {planTransactionCorrection} from '../packages/application/correction-service.ts';
import {parseRows} from '../apps/web/src/importer.ts';
import {legacyDraftToExternalRecord,legacyDraftToInterpretation} from '../apps/web/src/import-v2-adapter.ts';
import {readPersistedCaptureEvidence} from '../packages/importing/persisted-capture-evidence.ts';
import type {ExternalRecord,CaptureEvidence,EventInterpretation} from '../packages/importing/types.ts';
const at='2026-01-01T04:00:00Z';
function screenshot(session:string,refundIds:(string|null)[]=[null],amounts=[722],overrides:Partial<CaptureObservation['facts']>={}){
 const evidence=captureEvidence({contentHash:'image-'+session,schemaVersion:'2',promptVersion:'draft',model:'fixture',pageKind:'payment_detail',sourceSystem:'WECHAT',platformRaw:'微信',profile:'本人',rawExtraction:'synthetic '+session,capturedAt:at});
 const records=captureEventRecords(evidence,session,refundIds.map((refundId,i)=>({role:'EVENT',key:'refund-'+i,region:'refund-'+i,ordinal:i,sourceClass:'refund',facts:{occurredAt:at,amountFen:amounts[i]??amounts[0],precision:'second',transactionTypeRaw:'商户退款',directionRaw:'收入',statusRaw:'退款成功',channelRaw:'零钱',counterpartyRaw:'测试商户',productRaw:'退款',noteRaw:'',sourceCategoryRaw:'',orderId:'P',refundId,originalOrderId:null,...overrides}})),4);
 return {records,evidence:[evidence]};
}
function excel(session:string,ids=['R'],amounts=[722]){
 const rows=[['微信支付账单明细'],['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号','退款单号','原交易单号'],...ids.map((id,i)=>['2026-01-01 12:00:00','商户退款','测试商户','退款','收入',((amounts[i]??amounts[0])/100).toFixed(2),'零钱','退款成功',id,id,'P'])];
 const drafts=parseRows(rows),records=drafts.map((d,i)=>legacyDraftToExternalRecord(d,session,at,session+':'+i));
 return {records,evidence:[] as CaptureEvidence[],interpretations:drafts.map((d,i)=>legacyDraftToInterpretation(d,records[i]))};
}
function meanings(records:ExternalRecord[]):EventInterpretation[]{return records.map(r=>({externalRecordId:r.id,eventKind:'REFUND',status:'SUCCESS',amountFen:r.facts.amountFen,occurredAt:r.facts.occurredAt,displayName:'测试退款',channelRaw:r.facts.channelRaw,categorySuggestion:null,evidence:[]}));}
function fixture(){
 const store=new MemoryStore(fresh()),workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace),business=new BusinessAccountingService(store,store.state.device);
 async function ingest(data:{records:ExternalRecord[];evidence:CaptureEvidence[];interpretations?:EventInterpretation[]}){
  const sessionId=data.records[0].sessionId,ledger={entities:store.entities,conflicts:store.conflicts};
  const prepared=await service.prepare({sessionId,sourceType:data.records[0].sourceType,sourceSystem:data.records[0].sourceSystem,records:data.records,interpretations:data.interpretations??meanings(data.records),captureEvidence:data.evidence,ledger,now:at});
  const resolved=await service.resolve({prepared,records:data.records,ledger,now:at}),plan=planImportCommit(resolved,data.records),execution=planImportExecution(plan,ledger,at);
  business.executeBatch(execution.commands);return {prepared,resolved,plan,execution};
 }
 const transactions=()=>store.entities.filter(e=>e.type==='transactions');
 return {store,business,ingest,transactions};
}
test('05 unnumbered refund then 06 numbered detail supplements the same transaction and is stable on reimport',async()=>{
 const h=fixture();await h.ingest(screenshot('05'));const id=h.transactions()[0].id;
 const detail=screenshot('06',['R']),result=await h.ingest(detail);
 assert.equal(h.transactions().length,1);assert.equal(h.transactions()[0].id,id);assert.equal(result.prepared.records[0].attachEvidence,true);assert.equal(result.plan.blockedRecordIds.length,0);
 assert.equal(h.store.entities.filter(e=>e.type==='source_records').length,2);assert.equal(readPersistedCaptureEvidence(h.store.entities).evidence.length,2);
 const again=await h.ingest(detail);assert.equal(again.execution.createdIds.length,0);assert.equal(h.store.entities.filter(e=>e.type==='source_records').length,2);
});
test('real Excel parser and screenshot share one refund in both arrival orders',async()=>{
 for(const reverse of [false,true]){const h=fixture(),image=screenshot('image'),file=excel('file');
  assert.equal(file.records[0].sourceIdentity,strongSourceEventIdentity('微信','本人','refund','R'));
  await h.ingest(reverse?file:image);const result=await h.ingest(reverse?image:file);
  assert.equal(h.transactions().length,1);assert.equal(result.prepared.records[0].attachEvidence,true);assert.deepEqual(result.plan.blockedRecordIds,[]);
  assert.equal(h.store.entities.filter(e=>e.type==='balance_movements').reduce((sum,e)=>sum+Number(e.fields.amount),0),722);
 }
});
test('14 two distinct refunds retain both events when later Excel supplies individual IDs in either order',async()=>{
 for(const reverse of [false,true]){const h=fixture(),image=screenshot('14',[null,null],[26,44]),file=excel('file',['RA','RB'],[26,44]);
  await h.ingest(reverse?file:image);const result=await h.ingest(reverse?image:file);
  assert.equal(h.transactions().length,2);assert.deepEqual(h.transactions().map(t=>t.fields.display_amount).sort(),[26,44]);assert.deepEqual(result.plan.blockedRecordIds,[]);
  assert.equal(h.store.entities.filter(e=>e.type==='source_records').length,4);
 }
});
test('two identical weak refund observations cannot both claim one numbered refund',async()=>{
 const h=fixture();await h.ingest(screenshot('weak',[null,null],[26,26]));
 // Weak observations may not merge each other at first posting; later numbered evidence must see both.
 assert.equal(h.transactions().length,2);const r=await h.ingest(excel('strong',['R'],[26]));
 assert.equal(h.transactions().length,2);assert.equal(r.plan.blockedRecordIds.length,1);assert.equal(r.prepared.records[0].attention[0].kind,'POSSIBLE_DUPLICATE');
});
test('two distinct refund IDs in one batch cannot both claim a single unnumbered transaction',async()=>{
 const h=fixture();await h.ingest(screenshot('weak'));const r=await h.ingest(excel('strong',['RA','RB']));
 assert.equal(h.transactions().length,1);assert.equal(r.plan.blockedRecordIds.length,2);
});
test('minute/day precision or missing parent gives a candidate without automatic merge',async()=>{
 for(const overrides of [{precision:'minute'}, {precision:'day'}, {orderId:null,originalOrderId:null}]){
  const h=fixture();await h.ingest(screenshot('weak',[null],[722],overrides));const r=await h.ingest(excel('strong'));
  assert.equal(h.transactions().length,1);assert.equal(r.plan.blockedRecordIds.length,1);assert.equal(r.prepared.records[0].attachEvidence,undefined);
 }
});
test('acquired strong identity prevents another refund ID from reusing an old weak observation',async()=>{
 const h=fixture();await h.ingest(screenshot('weak'));await h.ingest(excel('one',['R1']));await h.ingest(excel('two',['R2']));
 assert.equal(h.transactions().length,2);assert.equal(h.store.entities.filter(e=>e.type==='balance_movements').reduce((sum,e)=>sum+Number(e.fields.amount),0),1444);
});
test('matching uses immutable source facts and never overwrites subsequent user corrections',async()=>{
 const h=fixture();await h.ingest(screenshot('weak'));const tx=h.transactions()[0];
 h.business.executeBatch(planTransactionCorrection({transactionId:tx.id,expectedSnapshot:correctionSnapshot(h.store.entities,tx.id),correctedAt:at,replacement:{kind:'REFUND',id:tx.id,occurredAt:at,name:'用户名称',amount:800,destination:null,originalId:null,categoryId:'用户分类',consumptionReduction:0}}, {entities:h.store.entities,conflicts:h.store.conflicts}).commands);
 const r=await h.ingest(excel('strong'));assert.equal(r.plan.blockedRecordIds.length,0);assert.equal(h.transactions().length,1);assert.equal(h.transactions()[0].fields.display_amount,800);assert.equal(h.transactions()[0].fields.display_name,'用户名称');
});
test('numbered evidence pointing to a deleted weak refund neither creates nor restores a transaction',async()=>{
 const h=fixture();await h.ingest(screenshot('weak'));const tx=h.transactions()[0];h.business.execute({kind:'DELETE_TRANSACTION',transactionId:tx.id,deletedAt:at});
 const r=await h.ingest(excel('strong'));assert.equal(h.transactions().length,1);assert.equal(h.transactions()[0].fields.deleted_at,at);assert.equal(r.plan.blockedRecordIds.length,1);
});
test('one mixed screenshot batch uses the numbered representative and attaches its weak evidence without another posting',async()=>{
 const h=fixture(),a=screenshot('mixed',[null]),b=screenshot('mixed',['R']);b.records[0].id+='strong';
 // Two observations of the same image event can carry weak and strong identities.
 const r=await h.ingest({records:[...a.records,...b.records],evidence:[...a.evidence]});
 assert.equal(r.plan.newRecords.length,1);assert.equal(h.transactions().length,1);assert.equal(h.store.entities.filter(e=>e.type==='source_records').length,2);
});
test('same strong identity with changed amount uses existing source review instead of a silent supplemental merge',async()=>{
 const h=fixture();await h.ingest(screenshot('one',['R']));const r=await h.ingest(screenshot('two',['R'],[800]));
 assert.equal(h.transactions().length,1);assert.equal(h.transactions()[0].fields.display_amount,722);assert.equal(r.prepared.records[0].disposition,'SOURCE_UPDATE');
});
test('platform/profile and failed observations cannot cross-link',async()=>{
 const h=fixture();await h.ingest(screenshot('weak'));const file=excel('strong');file.records[0].profile='其他人';file.records[0].sourceIdentity=strongSourceEventIdentity('微信','其他人','refund','R');
 assert.equal(planRefundEvidenceMatches(file.records,file.interpretations,h.store.entities).size,0);
 const failed=meanings(file.records).map(i=>({...i,status:'FAILED' as const}));assert.equal(planRefundEvidenceMatches(file.records,failed,h.store.entities).size,0);
});

test('new funding or original relation information stays on the existing source-change review path',async()=>{
 for(const overrides of [{channelRaw:'银行卡(1234)'},{originalOrderId:'OTHER',orderId:'OTHER'},{feeFen:10}]){
  const h=fixture();await h.ingest(screenshot('first',['R']));const r=await h.ingest(screenshot('changed',['R'],[722],overrides));
  assert.equal(r.prepared.records[0].disposition,'SOURCE_UPDATE');assert.equal(h.transactions().length,1);
 }
});

test('a mixed batch with two weak observations competing for one numbered event posts only the numbered representative',async()=>{
 const h=fixture(),a=screenshot('mixed',[null,null,'R'],[722,722,722]);const r=await h.ingest(a);
 assert.equal(h.transactions().length,1);assert.equal(r.plan.blockedRecordIds.length,2);assert.equal(r.plan.newRecords.length,1);
});
test('competing numbered snapshots do not leave a weak supplement pointing to a nonexistent representative',async()=>{
 const h=fixture(),a=screenshot('mix-a',[null]),b=screenshot('mix-b',['R']),c=screenshot('mix-c',['R']);
 b.records[0].sessionId='mix-a';c.records[0].sessionId='mix-a';
 const r=await h.ingest({records:[...a.records,...b.records,...c.records],evidence:[...a.evidence,...b.evidence,...c.evidence]});
 assert.equal(h.transactions().length,0);assert.equal(r.plan.blockedRecordIds.length,3);assert.equal(r.plan.evidenceUpdates.length,0);
});
