import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCaptureImport,planCaptureImport,captureImportSessionId} from '../packages/application/capture-import.ts';
import {newCaptureTask,changeCaptureTask} from '../packages/application/capture-task.ts';
import {captureMoneyFen,captureTime,parseCaptureResponse} from '../packages/importing/capture-response.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {transactionEditContext,planDetailEdit} from '../packages/application/transaction-edit.ts';
const at='2026-10-06T00:00:00Z',now=Date.parse(at),scope={userId:'u',ledgerId:'l'};
const category={availableCategoryIds:['其他','购物','用户分类'],fallbackCategoryId:'其他',aiCategoryId:'购物'};
function raw(patch:Record<string,unknown>={}){return JSON.stringify({evidence:{platform:'微信',displayAmount:'10.00',status:'支付成功',merchant:'合成商户',paymentMethod:'',fields:[],identifiers:[{role:'交易单号',value:'TEST-ORDER',visible:true}],times:[{role:'支付时间',value:'2026-01-01 12:00:00',precision:'second'}],moneyLines:[{role:'支出',amount:'10.00',time:'2026-01-01 12:00:00',status:'支付成功'}],uncertain:[],...patch},candidates:[{kind:'INCOME',amount:999999,category:'恶意候选'}]});}
function extraction(payload=raw(),id='t') {return extractCaptureImport({raw:payload,schemaVersion:'experiment-1',promptVersion:'experiment-1',model:'hy-vision-2.0-instruct',sourceSystem:'WECHAT',profile:'本人',contentHash:'image-'+id,capturedAt:at,sessionId:captureImportSessionId(scope,id)});}
function ready(e:ReturnType<typeof extraction>,id='t'){
 let t=newCaptureTask(scope,id,e.evidence.contentHash,'request-1',now,now+10000);
 for(const [action,delta] of [[{kind:'START_UPLOAD'},1],[{kind:'ACCEPT',imageRef:'private-image',remoteTaskId:'remote'},2],[{kind:'CLAIM',token:'w',leaseUntil:now+1000},3],[{kind:'RESULT',token:'w',attempt:1,result:{id:e.evidence.id,schemaVersion:e.evidence.schemaVersion,promptVersion:e.evidence.promptVersion,responseHash:e.evidence.responseHash}},4]] as const)t=changeCaptureTask(t,action,now+delta);
 return t;
}
async function plan(e:ReturnType<typeof extraction>,store=new MemoryStore(fresh()),task=ready(e)){
 return planCaptureImport({extraction:e,task,scope,ledger:{entities:store.entities,conflicts:store.conflicts},service:new ImportStatementService(new InMemoryImportWorkspace()),category,now:new Date(now+5).toISOString()});
}
test('strict response adapter ignores model candidates and rejects prose, unsupported schema and numeric IDs',()=>{
 const e=extraction();assert.equal(e.interpretations[0].eventKind,'PURCHASE');assert.equal(e.records[0].facts.amountFen,1000);
 assert.throws(()=>extraction(raw()+' explanation'),/INVALID_CAPTURE_RESPONSE_JSON/);
 assert.throws(()=>parseCaptureResponse(raw(),'2'),/UNSUPPORTED_CAPTURE_RESPONSE_SCHEMA/);
 assert.throws(()=>extraction(raw({identifiers:[{role:'交易单号',value:123456789012345678,visible:true}]})),/INVALID_CAPTURE_RESPONSE_FIELD/);
});
test('exact cents reject fractions, scientific notation and unsafe integers without rounding',()=>{
 assert.equal(captureMoneyFen('-0.26'),26);assert.equal(captureMoneyFen(7.22),722);
 for(const v of ['0.001','1e3','9,000.00','9007199254740992'])assert.equal(captureMoneyFen(v),null);
});
test('local date validation retains precision and rejects impossible date or declared mismatch',()=>{
 assert.deepEqual(captureTime('2026-1-1 12:11','minute'),{occurredAt:'2026-01-01T04:11:00.000Z',precision:'minute'});
 assert.equal(captureTime('2026-02-30 12:00:00').occurredAt,null);
 assert.equal(captureTime('2026-01-01 12:11','second').occurredAt,null);
});
test('payment plus two refunds creates three events; total never creates a fourth',async()=>{
 const e=extraction(raw({status:'已退款(¥0.70)',moneyLines:[{role:'支出',amount:'79.59',time:'2026-01-01 12:00:00',status:'支付成功'},{role:'退款',amount:'0.26',time:'2026-01-01 12:10:00',status:'已退款'},{role:'退款',amount:'0.44',time:'2026-01-01 12:11:00',status:'已退款'},{role:'退款合计',amount:'0.70',time:null,status:null}]}));
 assert.deepEqual(e.interpretations.map(i=>i.eventKind),['PURCHASE','REFUND','REFUND']);assert.deepEqual(e.records.map(r=>r.facts.amountFen),[7959,26,44]);
 const p=await plan(e);assert.equal(p.kind,'IMPORT_PLAN');if(p.kind==='IMPORT_PLAN')assert.equal(p.execution.createdIds.length,3);
});
test('refund summary disagreement stays reviewable without preparing any financial commands',async()=>{
 const e=extraction(raw({status:'已退款(¥0.70)',moneyLines:[{role:'退款',amount:'0.26',time:'2026-01-01 12:10:00',status:'已退款'}]}));
 const p=await plan(e);assert.equal(p.kind,'EXTRACTION_REVIEW');assert.ok(e.issues.some(i=>i.code==='REFUND_SUMMARY_MISMATCH'));
});
test('withdrawal separates principal and fee; unknown time or amount goes through shared questions',async()=>{
 const e=extraction(raw({status:'银行告知已到账',fields:[{label:'提现金额',value:'1500.00',visible:true},{label:'服务费',value:'1.50',visible:true}],moneyLines:[{role:'提现金额',amount:'1500.00',time:'2026-01-01 12:00:00',status:'已到账'},{role:'服务费',amount:'1.50',time:null,status:null},{role:'合计到账',amount:'1501.50',time:null,status:null}]}));
 assert.equal(e.records.length,1);assert.equal(e.interpretations[0].eventKind,'WITHDRAWAL');assert.equal(e.records[0].facts.amountFen,150000);assert.equal(e.records[0].facts.feeFen,150);
 const invalid=extraction(raw({times:[],moneyLines:[{role:'支出',amount:'10.001',time:null,status:'支付成功'}]}));const p=await plan(invalid);
 assert.equal(p.kind,'IMPORT_PLAN');if(p.kind==='IMPORT_PLAN'){assert.equal(p.execution.createdIds.length,0);assert.ok(p.resolved.records[0].attention.some(a=>a.kind==='AMOUNT'));assert.ok(p.resolved.records[0].attention.some(a=>a.kind==='DATE'));}
});
test('settled payment awaiting delivery is successful; own ledger screenshot is not payment evidence',async()=>{
 assert.equal(extraction(raw({status:'等待确认收货',moneyLines:[{role:'支出',amount:'6.60',time:'2026-01-01 12:00:00',status:'等待确认收货'}]})).interpretations[0].status,'SUCCESS');
 const e=extraction(raw({platform:'星账',times:[{role:'记录时间',value:'2026-01-01 12:11',precision:'minute'}]}));assert.equal((await plan(e)).kind,'NO_PAYMENT_EVIDENCE');assert.equal(e.records.length,0);
});
test('late retry preserves latest user category, amount and note instead of request-time suggestions',async()=>{
 const e=extraction(),store=new MemoryStore(fresh()),p=await plan(e,store);assert.equal(p.kind,'IMPORT_PLAN');if(p.kind!=='IMPORT_PLAN')return;
 new BusinessAccountingService(store,store.state.device).executeBatch(p.execution.commands);const id=p.execution.createdIds[0],ledger={entities:store.entities,conflicts:store.conflicts};
 new AccountingService(store,store.state.device).execute(planDetailEdit({transactionId:id,expectedSnapshot:transactionEditContext(ledger,id).expectedSnapshot,changedFields:{category:'用户分类',amount:'12.00',note:'用户备注'}},ledger));
 const before=structuredClone(store.entities),retry=await plan(e,store);assert.equal(retry.kind,'IMPORT_PLAN');if(retry.kind!=='IMPORT_PLAN')return;
 assert.equal(retry.categories[0].authority,'USER');assert.equal(retry.categories[0].categoryId,'用户分类');assert.equal(retry.execution.commands.length,0);assert.deepEqual(store.entities,before);
});
test('cancelled, foreign scope or replaced result cannot prepare imports or produce writes',async()=>{
 const e=extraction(),t=ready(e);
 await assert.rejects(plan(e,undefined,changeCaptureTask(t,{kind:'CANCEL'},now+5)),/CAPTURE_IMPORT_TASK_NOT_READY/);
 await assert.rejects(plan(e,undefined,{...t,userId:'other'}),/CAPTURE_SCOPE_MISMATCH/);
 await assert.rejects(plan(e,undefined,{...t,result:{...t.result!,responseHash:'replaced'}}),/CAPTURE_IMPORT_RESULT_MISMATCH/);
});

test('actual ledger/outcomes and task receipt share SQLite commit; stale or failed writes roll back all',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {SqliteCaptureTaskRepository}=await import('../packages/storage/capture-task-store.ts');
 const {CaptureTaskService}=await import('../packages/application/capture-task.ts');const {completeCaptureImport}=await import('../packages/application/capture-import.ts');
 const {interpret,applyCommands}=await import('../packages/accounting/business.ts');
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE ledger_state (payload TEXT);CREATE TABLE import_results (payload TEXT)');
  const initial={entities:[],conflicts:[]};db.prepare('INSERT INTO ledger_state VALUES(?)').run(JSON.stringify(initial));
  const readLedger=()=>JSON.parse(String(db.prepare('SELECT payload FROM ledger_state').get()!.payload));
  const e=extraction(),repository=new SqliteCaptureTaskRepository(db),tasks=new CaptureTaskService(repository);
  await repository.create(newCaptureTask(scope,'t',e.evidence.contentHash,'request-1',now,now+10000));
  let t=await repository.get(scope,'t');const r=ready(e);
  // Drive the durable repository through the same transitions as the extraction fixture.
  for(const [action,delta] of [[{kind:'START_UPLOAD'},1],[{kind:'ACCEPT',imageRef:'image',remoteTaskId:'remote'},2],[{kind:'CLAIM',token:'w',leaseUntil:now+1000},3],[{kind:'RESULT',token:'w',attempt:1,result:r.result!},4]] as const)t=await tasks.change(scope,'t',t!.version,action,now+delta);
  const p=await plan(e,undefined,t!);assert.equal(p.kind,'IMPORT_PLAN');if(p.kind!=='IMPORT_PLAN')return;
  t=await tasks.change(scope,'t',t!.version,{kind:'BEGIN_COMMIT',token:'commit',leaseUntil:now+1000},now+6);
  const write=(outcomes:unknown)=>{let ledger=readLedger();for(const c of p.execution.commands)ledger=applyCommands(ledger,interpret(c,ledger));db.prepare('UPDATE ledger_state SET payload=?').run(JSON.stringify(ledger));db.prepare('INSERT INTO import_results VALUES(?)').run(JSON.stringify(outcomes));};
  await assert.rejects(completeCaptureImport({plan:p,task:t,tasks,token:'commit',now:now+7,readLedger,writeLedgerAndOutcomes:(_,outcomes)=>{write(outcomes);throw Error('injected-failure');}}),/injected-failure/);
  assert.deepEqual(readLedger(),initial);assert.equal(db.prepare('SELECT COUNT(*) n FROM import_results').get()!.n,0);assert.equal((await repository.get(scope,'t'))!.state,'COMMITTING');
  const complete=await completeCaptureImport({plan:p,task:t,tasks,token:'commit',now:now+8,readLedger,writeLedgerAndOutcomes:(_,outcomes)=>write(outcomes)});
  assert.equal(complete.state,'COMPLETED');assert.equal(complete.cleanup,'PENDING');assert.equal(complete.receipt!.outcomeRecordIds.length,1);
  assert.equal(readLedger().entities.filter((x:{type:string})=>x.type==='transactions').length,1);assert.equal(db.prepare('SELECT COUNT(*) n FROM import_results').get()!.n,1);
  await assert.rejects(completeCaptureImport({plan:p,task:t,tasks,token:'commit',now:now+9,readLedger,writeLedgerAndOutcomes:()=>assert.fail('replayed write')}),/CAPTURE_VERSION_CONFLICT/);
 }finally{db.close();}
});

test('edit after planning invalidates commit inside task transaction before writing financial facts',async()=>{
 const {DatabaseSync}=await import('node:sqlite');const {SqliteCaptureTaskRepository}=await import('../packages/storage/capture-task-store.ts');
 const {CaptureTaskService}=await import('../packages/application/capture-task.ts');const {completeCaptureImport}=await import('../packages/application/capture-import.ts');
 const db=new DatabaseSync(':memory:');try{
  const e=extraction(),repository=new SqliteCaptureTaskRepository(db),tasks=new CaptureTaskService(repository);
  await repository.create(newCaptureTask(scope,'t',e.evidence.contentHash,'request-1',now,now+10000));let t=ready(e);
  // Seed through CAS in this reference test, then use the normal commit lease.
  assert.equal(await repository.replace(scope,'t',0,{...t,version:1}),true);t=await tasks.change(scope,'t',1,{kind:'BEGIN_COMMIT',token:'commit',leaseUntil:now+1000},now+6);
  const p=await plan(e,undefined,t);assert.equal(p.kind,'IMPORT_PLAN');if(p.kind!=='IMPORT_PLAN')return;
  await assert.rejects(completeCaptureImport({plan:p,task:t,tasks,token:'commit',now:now+7,readLedger:()=>({entities:[{type:'ledger_settings',id:'changed',fields:{value:'changed'}}],conflicts:[]}),writeLedgerAndOutcomes:()=>assert.fail('stale write')}),/STALE_CAPTURE_IMPORT_PLAN/);
  assert.equal((await repository.get(scope,'t'))!.state,'COMMITTING');
 }finally{db.close();}
});

test('unmapped monetary lines are retained as review issues rather than silently dropped',async()=>{
 const e=extraction(raw({moneyLines:[{role:'支出',amount:'10.00',time:'2026-01-01 12:00:00',status:'支付成功'},{role:'其他资金变化',amount:'2.00',time:null,status:null}]}));
 assert.ok(e.issues.some(i=>i.code==='UNSUPPORTED_CAPTURE_MONEY_ROLE'));assert.equal((await plan(e)).kind,'EXTRACTION_REVIEW');
});
