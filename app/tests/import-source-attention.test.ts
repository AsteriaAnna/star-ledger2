import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh,validateImportWorkspace} from '../apps/web/src/store.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {BusinessAccountingService,correctionSnapshot} from '../packages/accounting/business.ts';
import {planTransactionCorrection} from '../packages/application/correction-service.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {resolveLegacyImportBatch} from '../apps/web/src/import-v2-flow.ts';
import {parseRows,csv} from '../apps/web/src/importer.ts';
import {planImportExecution,importRecordOutcomes,completeImportSessionFromOutcomes} from '../packages/application/import-execution.ts';
import {planImportSourceAnswer,sourceReviewContext} from '../packages/application/import-source-attention.ts';
import {planResumeImport} from '../packages/application/import-resume.ts';

const at='2026-10-03T09:00:00Z';
const header='微信支付账单明细\n交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号\n';
const row=(amount:number,status='支付成功')=>`2026-09-20 12:00:00,商户消费,商户,商品,支出,${amount},,${status},same-order\n`;
function fixture(){
 const store=new MemoryStore(fresh()),business=new BusinessAccountingService(store,store.state.device);
 const snapshot=()=>({entities:store.entities,conflicts:store.conflicts});
 async function upload(id:string,text:string,columns=header){
  const workspace=new InMemoryImportWorkspace(store.state.importWorkspace),service=new ImportStatementService(workspace);
  const resolved=await resolveLegacyImportBatch({drafts:parseRows(csv(columns+text)),sessionId:id,ledger:snapshot(),now:at,service});
  const execution=planImportExecution(resolved.plan,snapshot(),at);business.executeBatch(execution.commands);
  const outcomes=importRecordOutcomes(id,execution,at),attention=await workspace.listAttentionItems(id);
  await workspace.replaceOutcomes(id,outcomes);await workspace.putSession(completeImportSessionFromOutcomes(resolved.result.session,outcomes,attention,at));
  store.state.importWorkspace=workspace.snapshot();return resolved;
 }
 function context(id:string){const workspace=store.state.importWorkspace!;return sourceReviewContext(id,workspace.attention[id].find(a=>a.kind==='SOURCE_UPDATE')!.id,workspace,snapshot());}
 async function answer(id:string,mode:'KEEP_EXISTING'|'APPLY_SOURCE',token=context(id).token){
  const c=context(id),plan=await planImportSourceAnswer({sessionId:id,attentionId:c.item.id,mode,expectedToken:token,now:at},store.state.importWorkspace!,snapshot());
  new AccountingService(store,store.state.device).execute(plan.commands);store.state.importWorkspace=plan.workspace;return plan;
 }
 return {store,business,snapshot,upload,context,answer};
}

test('keep existing preserves corrections and immutable evidence, persists decision, and reimport stays settled',async()=>{
 const h=fixture();await h.upload('first',row(10));const tx=h.store.entities.find(e=>e.type==='transactions')!;
 h.business.executeBatch(planTransactionCorrection({transactionId:tx.id,expectedSnapshot:correctionSnapshot(h.store.entities,tx.id),correctedAt:at,replacement:{kind:'PURCHASE',id:tx.id,name:'用户名称',note:'用户备注',occurredAt:String(tx.fields.occurred_at),amount:1200,payer:null,categoryId:'用户分类'}},h.snapshot()).commands);
 await h.upload('changed',row(20));const evidence=structuredClone(h.store.entities.filter(e=>e.type==='source_records'));
 await h.answer('changed','KEEP_EXISTING');
 assert.equal(h.store.entities.find(e=>e.type==='transactions')?.fields.display_amount,1200);
 assert.deepEqual(h.store.entities.filter(e=>e.type==='source_records'),evidence);
 assert.equal(h.store.state.importWorkspace!.attention.changed.length,0);
 assert.equal(h.store.entities.filter(e=>e.type==='import_rules'&&e.id.startsWith('v2-source-decision:')).length,1);
 await h.upload('again',row(20));assert.equal(h.store.state.importWorkspace!.attention.again.length,0);
 assert.equal(h.store.entities.filter(e=>e.type==='transactions').length,1);
 assert.equal(h.store.state.importWorkspace!.sessions.again.skippedDuplicateCount,1);
});

test('apply source changes financial facts while retaining user metadata and records its decision',async()=>{
 const h=fixture();await h.upload('first',row(10));const tx=h.store.entities.find(e=>e.type==='transactions')!;
 h.business.executeBatch(planTransactionCorrection({transactionId:tx.id,expectedSnapshot:correctionSnapshot(h.store.entities,tx.id),correctedAt:'2026-10-03T08:00:00Z',replacement:{kind:'PURCHASE',id:tx.id,name:'用户名称',note:'用户备注',occurredAt:String(tx.fields.occurred_at),amount:1200,payer:null,categoryId:'用户分类'}},h.snapshot()).commands);
 await h.upload('changed',row(20));await h.answer('changed','APPLY_SOURCE');
 const current=h.store.entities.find(e=>e.type==='transactions')!;
 assert.equal(current.id,tx.id);assert.equal(current.fields.display_amount,2000);assert.equal(current.fields.note,'用户备注');assert.equal(current.fields.display_name,'用户名称');
 assert.equal(h.store.entities.find(e=>e.type==='consumption_effects')?.fields.category_id,'用户分类');
 assert.equal(h.store.entities.filter(e=>e.type==='balance_movements').reduce((sum,e)=>sum+Number(e.fields.amount),0),-2000);
 assert.equal(h.store.state.importWorkspace!.sessions.changed.state,'COMPLETED');
});

test('fresh competing snapshots require explicit selection, retain both evidence versions, and finish every row',async()=>{
 const h=fixture();await h.upload('group',row(10)+row(20));
 assert.equal(h.store.entities.filter(e=>e.type==='transactions').length,0);
 await h.answer('group','APPLY_SOURCE');
 assert.equal(h.store.entities.filter(e=>e.type==='transactions').length,1);assert.equal(h.store.entities.filter(e=>e.type==='source_records').length,2);
 assert.equal(h.store.state.importWorkspace!.sessions.group.committedCount,1);assert.equal(h.store.state.importWorkspace!.sessions.group.skippedDuplicateCount,1);assert.equal(h.store.state.importWorkspace!.attention.group.length,0);
 await h.upload('again',row(10)+row(20));assert.equal(h.store.entities.filter(e=>e.type==='transactions').length,1);assert.equal(h.store.state.importWorkspace!.attention.again.length,0);
});

test('duplicate copies inside a conflicting source group do not inflate committed counts',async()=>{
 const h=fixture();await h.upload('group',row(10)+row(10)+row(20));await h.answer('group','APPLY_SOURCE');
 assert.equal(h.store.state.importWorkspace!.sessions.group.committedCount,1);
 assert.equal(h.store.state.importWorkspace!.sessions.group.skippedDuplicateCount,2);
 assert.equal(h.store.entities.filter(e=>e.type==='transactions').length,1);
});

test('changed ledger invalidates a preview without clearing questions or recording a decision',async()=>{
 const h=fixture();await h.upload('first',row(10));await h.upload('changed',row(20));const token=h.context('changed').token;
 h.business.execute({kind:'CREATE_ACCOUNT',id:'later',name:'新账户',accountType:'ASSET',openingBalance:null,openingBalanceAt:at});
 const before=structuredClone(h.store.state);await assert.rejects(h.answer('changed','APPLY_SOURCE',token),/STALE_SOURCE_REVIEW/);assert.deepEqual(h.store.state,before);
});

test('deleted target requires explicit restore decision; missing interpretations allow keep but never guess apply',async()=>{
 const h=fixture();await h.upload('first',row(10));const tx=h.store.entities.find(e=>e.type==='transactions')!;
 h.business.execute({kind:'DELETE_TRANSACTION',transactionId:tx.id,deletedAt:at});await h.upload('changed',row(20));
 delete h.store.state.importWorkspace!.interpretations;
 await assert.rejects(h.answer('changed','APPLY_SOURCE'),/IMPORT_INTERPRETATION_UNAVAILABLE/);
 await h.answer('changed','KEEP_EXISTING');const current=h.store.entities.find(e=>e.type==='transactions')!;
 assert.equal(current.fields.deleted_at,null);assert.equal(current.fields.display_amount,1000);
});

test('backup validator preserves captured interpretations and rejects cross-record references',async()=>{
 const h=fixture();await h.upload('first',row(10));const workspace=h.store.state.importWorkspace!;
 assert.deepEqual(validateImportWorkspace(JSON.parse(JSON.stringify(workspace))).interpretations,workspace.interpretations);
 const invalid=structuredClone(workspace);invalid.interpretations!.first[0].externalRecordId='missing';assert.throws(()=>validateImportWorkspace(invalid),/备份解释格式无效/);
});

test('a failed accounting write keeps financial facts, evidence decision and question together',async()=>{
 const h=fixture();await h.upload('first',row(10));await h.upload('changed',row(20));
 const before=structuredClone(h.store.state),append=h.store.append.bind(h.store);let writes=0;
 h.store.append=(op,local)=>{append(op,local);if(++writes===2)throw Error('INJECTED_STORAGE_FAILURE');};
 await assert.rejects(h.answer('changed','APPLY_SOURCE'),/INJECTED_STORAGE_FAILURE/);
 assert.deepEqual(h.store.state,before);assert.equal(h.store.entities.find(e=>e.type==='transactions')?.fields.display_amount,1000);
 h.store.append=append;await h.answer('changed','APPLY_SOURCE');assert.equal(h.store.state.importWorkspace!.attention.changed.length,0);
});

test('one exact evidence decision resolves matching questions in older sessions and stays settled on same-session retry',async()=>{
 const h=fixture();await h.upload('first',row(10));await h.upload('changed',row(20));
 const workspace=h.store.state.importWorkspace!,copy=structuredClone(workspace.records.changed[0]);copy.sessionId='copy';copy.id='copy-row';
 workspace.sessions.copy={...workspace.sessions.changed,id:'copy'};workspace.records.copy=[copy];workspace.attention.copy=workspace.attention.changed.map(a=>({...a,id:'copy-attention',sessionId:'copy',externalRecordId:copy.id}));workspace.outcomes.copy=[{sessionId:'copy',externalRecordId:copy.id,state:'BLOCKED',transactionId:null,updatedAt:at}];
 await h.answer('changed','KEEP_EXISTING');assert.equal(h.store.state.importWorkspace!.attention.copy.length,0);
 const service=new ImportStatementService(new InMemoryImportWorkspace(h.store.state.importWorkspace));
 const result=await service.prepare({sessionId:'changed',sourceType:'EXCEL',sourceSystem:'WECHAT',records:workspace.records.changed,interpretations:workspace.interpretations!.changed,ledger:h.snapshot(),now:at});
 assert.equal(result.records[0].disposition,'SKIP_DUPLICATE');assert.equal(result.records[0].attention.length,0);
});

test('interrupted processing resumes from captured interpretations, commits once and retains accurate outcomes',async()=>{
 const h=fixture(),workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace);
 await resolveLegacyImportBatch({drafts:parseRows(csv(header+row(10))),sessionId:'interrupted',ledger:h.snapshot(),now:at,service});
 const saved=workspace.snapshot();assert.equal(saved.sessions.interrupted.state,'PROCESSING');assert.equal(h.store.entities.length,0);
 const plan=await planResumeImport('interrupted',saved,h.snapshot(),at);h.business.executeBatch(plan.execution.commands);h.store.state.importWorkspace=plan.workspace;
 assert.equal(plan.session.state,'COMPLETED');assert.equal(plan.session.committedCount,1);assert.equal(h.store.entities.filter(e=>e.type==='transactions').length,1);
 await assert.rejects(planResumeImport('interrupted',plan.workspace,h.snapshot(),at),/IMPORT_SESSION_NOT_RESUMABLE/);
 const failed=structuredClone(plan.workspace);failed.sessions.interrupted.state='FAILED';failed.sessions.interrupted.failureCode='INTERRUPTED';
 const retry=await planResumeImport('interrupted',failed,h.snapshot(),at);assert.equal(retry.execution.commands.length,0);assert.equal(retry.session.committedCount,1);assert.equal(retry.session.skippedDuplicateCount,0);assert.equal(retry.session.failureCode,null);
});

test('resume rejects old sessions without interpretations without mutating captured evidence',async()=>{
 const h=fixture();await h.upload('first',row(10));const saved=structuredClone(h.store.state.importWorkspace!);saved.sessions.first.state='PROCESSING';delete saved.interpretations;
 const before=structuredClone(saved);await assert.rejects(planResumeImport('first',saved,h.snapshot(),at),/IMPORT_INTERPRETATION_UNAVAILABLE/);assert.deepEqual(saved,before);
});

test('an adopted refund source can add an explicit original relation without duplicating the refund',async()=>{
 const h=fixture();await h.upload('purchase',row(10));const original=h.store.entities.find(e=>e.type==='transactions')!;
 const columns=header.replace('交易单号\n','交易单号,原交易单号\n');
 const refund=(originalOrder:string)=>`2026-09-21 12:00:00,商户退款,商户,商品,收入,2,,退款成功,refund-order,${originalOrder}\n`;
 await h.upload('refund',refund(''),columns);await h.upload('changed',refund('same-order'),columns);
 await h.answer('changed','APPLY_SOURCE');
 const returns=h.store.entities.filter(e=>e.type==='transactions'&&e.fields.event_type==='REFUND');assert.equal(returns.length,1);
 const links=h.store.entities.filter(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.from_transaction_id===returns[0].id);
 assert.equal(links.length,1);assert.equal(links[0].fields.to_transaction_id,original.id);
});
