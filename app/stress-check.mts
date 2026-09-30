// Stress-test harness for the single-person ledger import/dedup/delete/restore flow.
// Mirrors the exact logic from apps/web/src/main.ts (importFile / commitImport /
// restoreTransaction / refresh) using the pure modules, so it exercises the real code.
import {MemoryStore,fresh} from './apps/web/src/store.ts';
import {parseRows,type Draft} from './apps/web/src/importer.ts';
import {money,sourceUTC,hash} from './apps/web/src/normalize.ts';
import {reviewDraft,ruleCommand,existingSource,safeCandidates,identicalInterpretation,sourcePayload} from './apps/web/src/import-workflow.ts';
import {resolveAccount,accountSetupGroups,allowedAccount} from './apps/web/src/account-matcher.ts';
import {configureImportAccounts,rememberAccount} from './apps/web/src/import-accounts.ts';
import {refundContext,importTransactionId} from './apps/web/src/refund-matcher.ts';
import {linkAvailableRefunds} from './apps/web/src/import-refunds.ts';
import {BusinessAccountingService} from './packages/accounting/business.ts';
import {AccountingService} from './packages/accounting/index.ts';
import {project} from './packages/sync/projection.ts';
import {accountBalance,consumptionInPeriod} from './packages/analytics/index.ts';

// ---- faithful replica of main.ts commandFrom ----
function commandFrom(v:any):any{
  const amount=money(String(v.amount));
  const date=new Date(sourceUTC(v.date));
  if(!Number.isFinite(date.getTime()))throw Error('请填写有效的交易时间');
  const base={id:v.key?importTransactionId(v):crypto.randomUUID(),occurredAt:date.toISOString(),name:v.name.trim(),amount,status:v.status as any,note:v.note||'',...(v.key?{source:{id:crypto.randomUUID(),sourceType:v.sourceType,platform:v.platform,rawPayload:JSON.stringify(sourcePayload(v))}}:{})};
  const a=v.account||null;const zero=(s:any)=>s===''||s===undefined||Number(s)===0?0:money(String(s));
  switch(v.kind){
    case 'PURCHASE':return {...base,kind:v.kind,payer:v.sponsor?null:a,categoryId:v.category,funding:v.sponsor?'EXTERNAL_SPONSOR':'OWN'};
    case 'INCOME':case 'TRANSFER_IN':return {...base,kind:v.kind,destination:a};
    case 'INTERNAL_TRANSFER':return {...base,kind:v.kind,from:a,to:v.to||null};
    case 'WITHDRAWAL':return {...base,kind:v.kind,from:a,to:v.to||null,fee:zero(v.fee)};
    case 'REPAYMENT':return {...base,kind:v.kind,from:a!,to:v.to};
    case 'REFUND':return {...base,kind:v.kind,originalId:v.original||null,destination:v.sponsor?null:a,funding:v.sponsor?'EXTERNAL_SPONSOR':'OWN',categoryId:v.category};
    case 'RETURN':return {...base,kind:v.kind,originalId:v.original||null,destination:v.sponsor?null:a,funding:v.sponsor?'EXTERNAL_SPONSOR':'OWN',categoryId:v.category,consumptionReduction:v.originalMode==='manual'?zero(v.consumption):undefined};
    case 'EXTERNAL_TRANSFER':case 'DEPOSIT':case 'RED_PACKET':return {...base,kind:v.kind,from:a,consumptionAmount:zero(v.consumption),categoryId:v.category};
    default:throw Error('未知交易类型');
  }
}

// ---- replica of refresh() ----
let store:MemoryStore;
let snap:ReturnType<typeof project>;
let drafts:Draft[];
function refresh(){
  snap=project(store.state.ops);
  drafts=structuredClone(store.state.imports||[]);
  // refreshDrafts: two passes like main.ts
  drafts.forEach(d=>reviewDraft(d,snap.entities,snap.conflicts));
  const context=refundContext(snap.entities,drafts);
  drafts.forEach(d=>reviewDraft(d,snap.entities,snap.conflicts,context));
}
// replica of importFile re-import dedup loop
function importRows(rows:any[][],profile='本人'){
  const incoming=parseRows(rows,{profile,batch:hash(rows)});
  const queue=structuredClone(store.state.imports||[]);
  const p=project(store.state.ops);
  for(const fresh of incoming){
    const index=queue.findIndex(d=>d.itemId===fresh.itemId);
    if(index>=0&&!['committed','linked'].includes(queue[index].workflow||''))continue;
    const d=fresh;reviewDraft(d,p.entities,p.conflicts);
    if(!existingSource(d,p.entities).length&&safeCandidates(d,p.entities).length)d.blockers=[...(d.blockers||[]),'DUPLICATE'];
    d.selected=!d.issue&&!['linked','noeffect','ignored'].includes(d.workflow||'');
    if(index>=0)queue[index]=d;else queue.push(d);
  }
  store.state.imports=queue;store.state.importRevision=(store.state.importRevision||0)+1;
  refresh();
}
// replica of commitImport (selected = allReady in our tests)
function commitImport(allReady=true){
  refresh();
  const indexes=drafts.map((_,i)=>i).filter(i=>(allReady?!drafts[i].issue:drafts[i].selected)&&!['ignored','noeffect','committed','linked','deferred'].includes(drafts[i].workflow||''));
  let count=0,skipped=0;
  const next=structuredClone(drafts);
  const svc=new BusinessAccountingService(store,store.state.device);
  const core=new AccountingService(store,store.state.device);
  indexes.sort((a,b)=>Number(['REFUND','RETURN'].includes(next[a].kind))-Number(['REFUND','RETURN'].includes(next[b].kind))||next[a].date.localeCompare(next[b].date));
  for(const i of indexes){
    const d=next[i],p=project(store.state.ops);
    reviewDraft(d,p.entities,p.conflicts);
    if(existingSource(d,p.entities).length){d.selected=false;continue;}
    if(d.issue){skipped++;continue;}
    const cmd=commandFrom(d);
    svc.execute(cmd);
    core.execute([ruleCommand(store.entities,'source-'+(d.identity||d.key),{transactionId:cmd.id})]);
    for(const role of ['account','to'] as const)if(d[role])rememberAccount(store,d,role,d[role]);
    d.workflow='committed';d.transactionId=cmd.id;d.selected=false;count++;
  }
  linkAvailableRefunds(store);
  store.state.imports=next;store.state.importRevision=(store.state.importRevision||0)+1;
  refresh();
  return {count,skipped};
}
// replica of setupImportAccounts -> configureImportAccounts
function setupAccounts(){
  refresh();
  const groups=accountSetupGroups(drafts,snap.entities.filter(e=>e.type==='accounts'),snap.entities.filter(e=>e.type==='import_rules'),snap.conflicts);
  if(!groups.length)return;
  configureImportAccounts(store,groups.map(g=>({key:g.key,accountId:'new',name:g.descriptor?.name||g.label,type:g.descriptor?.type||'ASSET'})),store.state.importRevision||0);
  refresh();
}
// replica of restoreTransaction
function restoreTransaction(id:string){
  new AccountingService(store,store.state.device).execute([{action:'RESOLVE_CONFLICT',entity:{type:'transactions',id,fields:{deleted_at:null}}}]);
  if(project(store.state.ops).conflicts.length)throw Error('恢复会与现有账务冲突，请先处理关联记录');
  refresh();
}
function deleteTransaction(id:string){
  new BusinessAccountingService(store,store.state.device).execute({kind:'DELETE_TRANSACTION',transactionId:id,deletedAt:new Date().toISOString()});
  refresh();
}
const transactions=()=>snap.entities.filter(e=>e.type==='transactions');
const activeTx=()=>transactions().filter(e=>!e.fields.deleted_at);
const deletedTx=()=>transactions().filter(e=>e.fields.deleted_at);
const bal=(id:string)=>accountBalance(snap,id,'2026-10-01T00:00:00Z').balance;
const spent=()=>consumptionInPeriod(snap,'2026-09-01T00:00:00Z','2026-10-01T00:00:00Z');

// ---- fixtures ----
const wxH=['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号'];
const wxRow=(order:string,amount='44.50',type='商户消费',product='午餐',dir='支出',channel='零钱',status='支付成功',date='2026-09-20 12:00:00')=>[date,type,'商户',product,dir,amount,channel,status,order];
const wxRows=(...rs:string[][]) => parseRows([wxH,...rs]);
// order-less weak-identity row (no 交易单号)
const wxNoOrder=(amount='5.00',product='早餐',date='2026-09-20 08:00:00')=>[date,'商户消费','商户',product,'支出',amount,'零钱','支付成功',''];

let results:{name:string;pass:boolean;detail:string}[]=[];
function check(name:string,cond:boolean,detail:string){results.push({name,pass:!!cond,detail});}
function freshStore(rows:any[][]):MemoryStore{
  const s=new MemoryStore({...fresh(),imports:[]});
  store=s;refresh();
  const incoming=parseRows(rows,{profile:'本人',batch:hash(rows)});
  store.state.imports=incoming.map(d=>({...d,selected:false}));
  refresh();
  return s;
}

// ===== Scenario 1: happy path import -> setup -> commit =====
{
  store=new MemoryStore(fresh());refresh();
  importRows([wxH,wxRow('o1','44.50')]);
  setupAccounts();
  const r=commitImport();
  check('S1 happy path: 1 committed, 0 skipped', r.count===1&&r.skipped===0, `count=${r.count} skipped=${r.skipped}`);
  const acct1=snap.entities.find(e=>e.type==='accounts')!.id;
  check('S1 account created but UNINITIALIZED (余额以后再补)', snap.entities.find(e=>e.type==='accounts')!.fields.balance_state==='UNINITIALIZED', `state=${snap.entities.find(e=>e.type==='accounts')!.fields.balance_state}`);
  // set an opening balance dated BEFORE the transaction, then verify the movement is applied
  new AccountingService(store,store.state.device).execute([{action:'PATCH_FIELD',entity:{type:'accounts',id:acct1,fields:{opening_balance:10000}}},{action:'PATCH_FIELD',entity:{type:'accounts',id:acct1,fields:{opening_balance_at:'2026-09-01T00:00:00Z'}}},{action:'PATCH_FIELD',entity:{type:'accounts',id:acct1,fields:{balance_state:'ESTABLISHED'}}}]);
  refresh();
  check('S1 balance after opening (dated before tx) = 10000 - 4450', bal(acct1)===5550, `balance=${bal(acct1)}`);
  check('S1 consumption=4450', spent()===4450, `spent=${spent()}`);
  check('S1 no conflicts', snap.conflicts.length===0, `conflicts=${snap.conflicts.length}`);
}

// ===== Scenario 2: duplicate import (same file twice, before commit) =====
{
  store=new MemoryStore(fresh());refresh();
  importRows([wxH,wxRow('o1')]);
  importRows([wxH,wxRow('o1')]);
  check('S2 re-import same file: queue stays 1', store.state.imports!.length===1, `queue=${store.state.imports!.length}`);
}

// ===== Scenario 3: delete -> re-import -> restore -> re-import =====
{
  store=new MemoryStore(fresh());refresh();
  importRows([wxH,wxRow('o1','44.50')]);setupAccounts();
  const r=commitImport();
  const txId=activeTx().find(t=>t.fields.event_type==='PURCHASE')!.id;
  const beforeSpent=spent();
  // delete
  deleteTransaction(txId);
  check('S3 after delete: 0 active, 1 deleted', activeTx().length===0&&deletedTx().length===1, `active=${activeTx().length} deleted=${deletedTx().length}`);
  check('S3 after delete: consumption drops to 0', spent()===0, `spent=${spent()}`);
  // re-import same file
  importRows([wxH,wxRow('o1','44.50')]);
  const linked=drafts[0];
  check('S3 re-import after delete: workflow=linked', linked.workflow==='linked', `workflow=${linked.workflow}`);
  check('S3 re-import after delete: no new transaction', activeTx().length===0, `active=${activeTx().length}`);
  check('S3 message mentions 回收站', /回收站/.test(linked.issue||''), `issue=${linked.issue}`);
  check('S3 re-import draft not selectable', linked.selected===false, `selected=${linked.selected}`);
  // restore
  restoreTransaction(txId);
  check('S3 after restore: 1 active again', activeTx().length===1, `active=${activeTx().length}`);
  check('S3 after restore: consumption restored', spent()===beforeSpent, `spent=${spent()}`);
  // re-import again after restore
  importRows([wxH,wxRow('o1','44.50')]);
  check('S3 re-import after restore: message = 来源已存在', /来源已存在/.test(drafts[0].issue||''), `issue=${drafts[0].issue}`);
  check('S3 no duplicate transaction', activeTx().length===1, `active=${activeTx().length}`);
}

// ===== Scenario 4: repeated delete/restore cycle =====
{
  store=new MemoryStore(fresh());refresh();
  importRows([wxH,wxRow('o1')]);setupAccounts();commitImport();
  const txId=activeTx().find(t=>t.fields.event_type==='PURCHASE')!.id;
  let ok=true,msg='';
  for(let i=0;i<3;i++){deleteTransaction(txId);restoreTransaction(txId);if(activeTx().length!==1||snap.conflicts.length){ok=false;msg=`cycle ${i}: active=${activeTx().length} conflicts=${snap.conflicts.length}`;break;}}
  check('S4 3x delete/restore cycle stable', ok, msg||`final active=${activeTx().length} conflicts=${snap.conflicts.length}`);
  check('S4 consumption intact', spent()===4450, `spent=${spent()}`);
}

// ===== Scenario 5: delete original with active (full) refund link is rejected =====
{
  store=new MemoryStore(fresh());refresh();
  importRows([wxH,wxRow('o1','44.50'),wxRow('o2','44.50','商户消费','退款-午餐','收入','零钱','退款成功','2026-09-21 12:00:00')]);
  setupAccounts();commitImport();
  const original=activeTx().find(t=>t.fields.event_type==='PURCHASE')!.id;
  const refund=activeTx().find(t=>t.fields.event_type==='REFUND')!.id;
  check('S5 full refund auto-linked to original', snap.entities.some(e=>e.type==='transaction_links'&&e.fields.from_transaction_id===refund), `linked=${snap.entities.some(e=>e.type==='transaction_links'&&e.fields.from_transaction_id===refund)}`);
  let rejected=false;
  try{deleteTransaction(original);}catch(e){rejected=/ACTIVE_RETURN_LINKS/.test(String(e));}
  check('S5 deleting original with active refund rejected', rejected, `rejected=${rejected}`);
}

// ===== Scenario 6: delete refund, restore refund =====
{
  store=new MemoryStore(fresh());refresh();
  importRows([wxH,wxRow('o1','44.50'),wxRow('o2','5.00','商户消费','退款-午餐','收入','零钱','退款成功','2026-09-21 12:00:00')]);
  setupAccounts();commitImport();
  const original=activeTx().find(t=>t.fields.event_type==='PURCHASE')!.id;
  const refund=activeTx().find(t=>t.fields.event_type==='REFUND')!.id;
  const afterRefund=spent();
  deleteTransaction(refund);
  check('S6 delete refund: consumption back to full', spent()===4450, `spent=${spent()}`);
  restoreTransaction(refund);
  check('S6 restore refund: consumption back', spent()===afterRefund, `spent=${spent()}`);
  check('S6 original still intact', activeTx().some(t=>t.id===original), '');
}

// ===== Scenario 7: order-less (weak identity) delete -> re-import from a DIFFERENT file =====
{
  store=new MemoryStore(fresh());refresh();
  // File A: the order-less transaction plus an unrelated row
  importRows([wxH,wxNoOrder('5.00','早餐','2026-09-20 08:00:00'),wxRow('zza','9.99')]);
  setupAccounts();commitImport();
  const txId=activeTx().find(t=>t.fields.event_type==='PURCHASE'&&t.fields.display_amount===500)!.id;
  deleteTransaction(txId);
  check('S7 setup: transaction deleted', deletedTx().length===1, `deleted=${deletedTx().length}`);
  // File B: SAME order-less transaction, but the file has a different sibling row -> different batch hash -> different identity
  importRows([wxH,wxNoOrder('5.00','早餐','2026-09-20 08:00:00'),wxRow('zzb','19.99')]);
  const d=drafts.find(x=>x.kind==='PURCHASE'&&x.amount==='5.00'&&!['committed','linked'].includes(x.workflow||''))!;
  check('S7 weak-identity re-import from different file: NOT recognized as 回收站', !/回收站/.test(d.issue||''), `issue=${d.issue||'(empty)'} workflow=${d.workflow}`);
  check('S7 weak-identity re-import does NOT flag DUPLICATE vs deleted', !(d.blockers||[]).includes('DUPLICATE'), `blockers=${(d.blockers||[]).join(',')||'none'}`);
  check('S7 it is selectable -> will silently create a duplicate', d.selected===true, `selected=${d.selected}`);
}

// ===== Scenario 8: amount corrected, then re-import -> flagged as difference =====
{
  store=new MemoryStore(fresh());refresh();
  importRows([wxH,wxRow('o1','44.50')]);setupAccounts();commitImport();
  const txId=activeTx().find(t=>t.fields.event_type==='PURCHASE')!.id;
  new BusinessAccountingService(store,store.state.device).execute({kind:'CORRECT_AMOUNT',transactionId:txId,amount:4000,expectedAmount:4450,reason:'实际40元',correctedAt:new Date().toISOString(),sourceId:crypto.randomUUID()});
  refresh();
  importRows([wxH,wxRow('o1','44.50')]);
  const d=drafts[0];
  check('S8 re-import after amount correction: linked + difference flagged', d.workflow==='linked'&&/不同/.test(d.issue||''), `issue=${d.issue}`);
  check('S8 no new transaction added', activeTx().length===1, `active=${activeTx().length}`);
}

// ===== Scenario 9: select-safe / commit-ready does not touch linked/deleted =====
{
  store=new MemoryStore(fresh());refresh();
  importRows([wxH,wxRow('o1')]);setupAccounts();commitImport();
  const txId=activeTx().find(t=>t.fields.event_type==='PURCHASE')!.id;
  deleteTransaction(txId);
  importRows([wxH,wxRow('o1'),wxRow('o9','12.00')]);
  setupAccounts();
  const r=commitImport(); // should only commit the NEW o9, not the linked o1
  check('S9 commit-ready after re-import: commits only new row', r.count===1, `count=${r.count} skipped=${r.skipped}`);
  check('S9 active tx = new row only (deleted o1 stays deleted)', activeTx().length===1&&activeTx()[0].fields.display_name!==undefined, `active=${activeTx().length}`);
}

// ===== Scenario 10: cross-file weak-identity DUPLICATE prompt vs within-file silence =====
{
  store=new MemoryStore(fresh());refresh();
  // within a single file, two identical order-less transactions are NOT flagged at import time
  importRows([wxH,wxNoOrder('5.00','早餐','2026-09-20 08:00:00'),wxNoOrder('5.00','早餐','2026-09-20 08:05:00')]);
  const withinFlagged=drafts.some(d=>(d.blockers||[]).includes('DUPLICATE'));
  check('S10a two identical weak rows in ONE file are NOT flagged DUPLICATE', withinFlagged===false, `flagged=${withinFlagged}`);
  // cross-file: commit file A, then import file B containing a matching weak transaction
  setupAccounts();commitImport();
  const before=activeTx().filter(t=>t.fields.display_amount===500).length;
  importRows([wxH,wxNoOrder('5.00','早餐','2026-09-20 08:00:00'),wxRow('zzx','3.33')]);
  const crossFlagged=drafts.some(d=>d.kind==='PURCHASE'&&d.amount==='5.00'&&(d.blockers||[]).includes('DUPLICATE'));
  check('S10b cross-file matching weak row flags DUPLICATE', crossFlagged, `flagged=${crossFlagged} (before=${before})`);
}

// ===== Scenario 11: ignore rule survives re-import =====
{
  store=new MemoryStore(fresh());refresh();
  importRows([wxH,wxRow('o1')]);
  // simulate queueAction('ignored')
  const next=structuredClone(drafts);next[0].workflow='ignored';next[0].selected=false;
  new AccountingService(store,store.state.device).execute([ruleCommand(store.entities,'ignore-'+(next[0].identity||next[0].key),{ignored:true})]);
  store.state.imports=next;refresh();
  importRows([wxH,wxRow('o1')]);
  check('S11 re-import of ignored source stays ignored', drafts[0].workflow==='ignored', `workflow=${drafts[0].workflow}`);
}

// ===== Scenario 12: delete refund THEN original, then restore order dependency =====
{
  store=new MemoryStore(fresh());refresh();
  importRows([wxH,wxRow('o1','44.50'),wxRow('o2','44.50','商户消费','退款-午餐','收入','零钱','退款成功','2026-09-21 12:00:00')]);
  setupAccounts();commitImport();
  const original=activeTx().find(t=>t.fields.event_type==='PURCHASE')!.id;
  const refund=activeTx().find(t=>t.fields.event_type==='REFUND')!.id;
  deleteTransaction(refund);           // refund first
  deleteTransaction(original);          // now allowed since refund is deleted
  check('S12 both deletable when refund goes first', deletedTx().length===2, `deleted=${deletedTx().length}`);
  let refundFirstErr='';
  try{restoreTransaction(refund);}catch(e){refundFirstErr=String(e);}
  check('S12 restoring refund before original is rejected', /冲突/.test(refundFirstErr), `err=${refundFirstErr||'(none)'}`);
  restoreTransaction(original);
  restoreTransaction(refund);
  check('S12 restore original first then refund succeeds', activeTx().length===2&&snap.conflicts.length===0, `active=${activeTx().length} conflicts=${snap.conflicts.length}`);
}

// ===== Scenario 13: restore a plain transaction after unrelated items were imported =====
{
  store=new MemoryStore(fresh());refresh();
  importRows([wxH,wxRow('o1','44.50')]);setupAccounts();commitImport();
  const txId=activeTx().find(t=>t.fields.event_type==='PURCHASE')!.id;
  deleteTransaction(txId);
  // import + commit a DIFFERENT transaction afterwards (unrelated history accumulates)
  importRows([wxH,wxRow('o2','12.00')]);setupAccounts();commitImport();
  restoreTransaction(txId);
  check('S13 restore after unrelated later imports is clean', activeTx().length===2&&snap.conflicts.length===0, `active=${activeTx().length} conflicts=${snap.conflicts.length}`);
}

// ===== Scenario 14: ignore then restore-import (un-ignore) actually clears the ignore rule =====
{
  store=new MemoryStore(fresh());refresh();
  importRows([wxH,wxRow('o1')]);
  // replica of queueAction('ignored')
  const next=structuredClone(drafts);next[0].selected=true;
  new AccountingService(store,store.state.device).execute([ruleCommand(store.entities,'ignore-'+(next[0].identity||next[0].key),{ignored:true})]);
  next[0].workflow='ignored';next[0].selected=false;store.state.imports=next;refresh();
  check('S14 after ignore: workflow=ignored', drafts[0].workflow==='ignored', `workflow=${drafts[0].workflow}`);
  // replica of queueAction('review') — restoring an ignored draft
  const n2=structuredClone(drafts);n2[0].selected=true;
  // condition: action==='ignored'||d.workflow==='ignored'  -> true -> write {ignored:false}
  new AccountingService(store,store.state.device).execute([ruleCommand(store.entities,'ignore-'+(n2[0].identity||n2[0].key),{ignored:false})]);
  n2[0].workflow='review';n2[0].selected=false;store.state.imports=n2;refresh();
  check('S14 restore-import clears ignore: workflow=review (not re-ignored)', drafts[0].workflow==='review', `workflow=${drafts[0].workflow} issue=${drafts[0].issue||'(empty)'}`);
}

// ===== print report =====
let fail=0;
for(const r of results){if(!r.pass)fail++;console.log(`${r.pass?'PASS':'FAIL'}  ${r.name}${r.detail?'  — '+r.detail:''}`);}
console.log(`\n${results.length-fail}/${results.length} passed, ${fail} failed`);
