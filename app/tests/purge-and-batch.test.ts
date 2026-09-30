import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRows} from '../apps/web/src/importer.ts';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {BusinessAccountingService,applyCommands} from '../packages/accounting/business.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import type {Command,LedgerSnapshot} from '../packages/accounting/index.ts';
import type {Entity} from '../packages/domain/index.ts';
import {project} from '../packages/sync/projection.ts';
import {aliasId} from '../apps/web/src/account-matcher.ts';
import {rememberAccountCommands} from '../apps/web/src/import-accounts.ts';
import {existingSource,reviewDraft,sourcePayload} from '../apps/web/src/import-workflow.ts';
const h=['交易时间','交易分类','交易对方','商品说明','收/支','金额','收/付款方式','交易状态','交易订单号'];
const row=(channel='农业银行储蓄卡(2372)',order='order1')=>['2026-09-20 12:00:00','餐饮美食','商户','午餐','支出','44.50',channel,'交易成功',order];
const parse=(rows:string[][])=>parseRows([h,...rows]);
const snapshot=(s:MemoryStore)=>project(s.state.ops);
const svc=(s:MemoryStore)=>new BusinessAccountingService(s,s.state.device);
const source=(d:any)=>({id:d.key+'-source',sourceType:'EXCEL' as const,platform:d.platform,rawPayload:JSON.stringify(sourcePayload(d))});

test('purged transaction leaves trash and re-imports as new, not revived',()=>{
 const s=new MemoryStore(fresh()),service=svc(s);
 service.execute({kind:'CREATE_ACCOUNT',id:'a',name:'卡',accountType:'ASSET',openingBalance:10000,openingBalanceAt:'2026-09-01T00:00:00Z'});
 const d=parse([row()])[0];
 service.execute({kind:'PURCHASE',id:'p',name:d.name,amount:4450,payer:'a',categoryId:'餐饮',occurredAt:'2026-09-20T04:00:00Z',source:source(d)});
 service.execute({kind:'DELETE_TRANSACTION',transactionId:'p',deletedAt:'2026-09-21T00:00:00Z'});
 const inTrash=(t:Entity)=>!!t.fields.deleted_at&&!t.fields.purged_at;
 assert.ok(s.entities.filter(e=>e.type==='transactions'&&inTrash(e)).length===1);
 // 彻底删除：软清除标记
 new AccountingService(s,s.state.device).execute([{action:'PATCH_FIELD',entity:{type:'transactions',id:'p',fields:{purged_at:'2026-09-30T00:00:00Z'}}}]);
 assert.ok(s.get('transactions','p')!.fields.purged_at);
 assert.equal(s.entities.filter(e=>e.type==='transactions'&&inTrash(e)).length,0);
 // 同来源重导不再命中已清除记录：当作新交易，非复活
 const d2=parse([row()])[0];
 assert.equal(existingSource(d2,s.entities).length,0);
 assert.equal(reviewDraft(d2,s.entities,[]).transactionId,undefined);
});

test('executeBatch deletes a batch identically to sequential deletes',()=>{
 const mk=()=>{const s=new MemoryStore(fresh()),service=svc(s);service.execute({kind:'CREATE_ACCOUNT',id:'a',name:'卡',accountType:'ASSET',openingBalance:null,openingBalanceAt:'2026-09-01T00:00:00Z'});for(let i=0;i<10;i++)service.execute({kind:'PURCHASE',id:'p'+i,name:'消费'+i,amount:100+i,payer:'a',categoryId:'其他',occurredAt:'2026-09-20T04:00:00Z'});return s;};
 const deletedAt='2026-09-21T00:00:00Z',ids=['p0','p1','p2','p3','p4','p5','p6','p7','p8','p9'];
 const a=mk(),b=mk();
 svc(a).executeBatch(ids.map(transactionId=>({kind:'DELETE_TRANSACTION' as const,transactionId,deletedAt})));
 for(const transactionId of ids)svc(b).execute({kind:'DELETE_TRANSACTION',transactionId,deletedAt});
 const stable=(s:MemoryStore)=>s.entities.map(e=>[e.type,e.id,JSON.stringify(e.fields)]).sort().join('|');
 assert.equal(stable(a),stable(b));
 assert.equal(a.state.ops.length,b.state.ops.length);
 assert.deepEqual(snapshot(a).conflicts,[]);
 assert.ok(ids.every(id=>a.get('transactions',id)!.fields.deleted_at));
});

test('applyCommands advance avoids duplicate alias rule in same-channel batch',()=>{
 const d1=parse([row()])[0];d1.account='a';d1.accountMode='manual';
 const d2=parse([row('农业银行储蓄卡(2372)','order2')])[0];d2.account='a';d2.accountMode='manual';
 let snap:LedgerSnapshot={entities:[],conflicts:[]};const cmds:Command[]=[];
 for(const d of [d1,d2]){const out=rememberAccountCommands(snap.entities,d,'account','a');cmds.push(...out);snap=applyCommands(snap,out);}
 const alias=aliasId(d1,'account');
 assert.equal(cmds.filter(c=>c.entity.type==='import_rules'&&c.entity.id===alias).length,1);
 assert.ok(cmds.length>0);
});

test('multiple PATCHes in one execute match sequential and cache conflicts correctly',()=>{
 const mk=()=>{const s=new MemoryStore(fresh()),service=svc(s);service.execute({kind:'CREATE_ACCOUNT',id:'a',name:'卡',accountType:'ASSET',openingBalance:null,openingBalanceAt:'2026-09-01T00:00:00Z'});service.execute({kind:'PURCHASE',id:'p',name:'消费',amount:100,payer:'a',categoryId:'其他',occurredAt:'2026-09-20T04:00:00Z'});return s;};
 const patches=()=>(['n1','n2','n3'] as const).map(note=>({action:'PATCH_FIELD' as const,entity:{type:'transactions' as const,id:'p',fields:{note}}}));
 const a=mk(),b=mk();
 new AccountingService(a,a.state.device).execute(patches());
 for(const c of patches())new AccountingService(b,b.state.device).execute([c]);
 assert.equal(a.get('transactions','p')!.fields.note,'n3');
 assert.equal(b.get('transactions','p')!.fields.note,'n3');
 assert.deepEqual(snapshot(a).conflicts,[]);
 assert.deepEqual(snapshot(b).conflicts,[]);
});

test('reset-ledger clears all ledger state back to a clean empty ledger',()=>{
 const s=new MemoryStore(fresh()),service=svc(s);
 service.execute({kind:'CREATE_ACCOUNT',id:'a',name:'卡',accountType:'ASSET',openingBalance:10000,openingBalanceAt:'2026-09-01T00:00:00Z'});
 service.execute({kind:'PURCHASE',id:'p',name:'消费',amount:100,payer:'a',categoryId:'其他',occurredAt:'2026-09-20T04:00:00Z'});
 s.state.settings.syncTarget='owner/repo/branch/ledger';s.state.settings.syncConfig={owner:'o',repo:'r',branch:'b',ledger:'l'};s.state.settings.lastSync='2026-09-30T00:00:00Z';
 s.state.imports=[parse([row()])[0]];
 const budget=s.state.settings.budget;
 // 模拟 reset-ledger action 的清理逻辑
 s.state.ops=[];s.state.pending=[];s.state.batches=[];s.state.envelopes={};s.state.imports=[];s.state.importRevision=(s.state.importRevision||0)+1;
 s.state.settings={...s.state.settings,demo:false,syncTarget:undefined,syncConfig:undefined,lastSync:undefined};
 assert.equal(project(s.state.ops).entities.length,0);
 assert.equal(s.state.ops.length,0);assert.equal(s.state.pending.length,0);assert.equal(s.state.batches.length,0);
 assert.deepEqual(s.state.envelopes,{});assert.equal(s.state.imports.length,0);
 assert.equal(s.state.settings.syncTarget,undefined);assert.equal(s.state.settings.syncConfig,undefined);assert.equal(s.state.settings.lastSync,undefined);
 assert.equal(s.state.settings.budget,budget); // 预算与分类等本机偏好保留
});
