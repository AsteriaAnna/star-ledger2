import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh,hash} from '../apps/web/src/store.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {PortableSyncEngine,FakeSyncProvider} from '../packages/sync/core.ts';
import {ledgerSettings,planLedgerSettings,planLegacyLedgerSettings} from '../packages/application/ledger-settings.ts';
import {SqliteStore} from '../packages/storage/index.ts';
import {webSessionCrypto} from '../packages/platform/web-crypto.ts';
const make=(device:string)=>{const state=fresh();state.device=device;return new MemoryStore(state);};
const snapshot=(s:MemoryStore)=>({entities:s.entities,conflicts:s.conflicts});
const save=(s:MemoryStore,values:Record<string,any>)=>new AccountingService(s,s.state.device).execute(p=>planLedgerSettings(values,p));
test('budget and categories survive encrypted transfer, reverse edit and repeat download without copying display preferences',async()=>{
 const a=make('a'),b=make('b');a.state.settings.mode='desktop';b.state.settings.mode='mobile';
 save(a,{budget:450000,categories:['餐饮','学费']});
 const provider=new FakeSyncProvider(),ea=new PortableSyncEngine(a,provider,hash),eb=new PortableSyncEngine(b,provider,hash);
 const cipher=await webSessionCrypto('settings-test','A'.repeat(43));
 const batches=ea.pendingBatches();const encrypted=await Promise.all(batches.map(x=>cipher.seal(x)));
 eb.applyBatches(await Promise.all(encrypted.map(x=>cipher.open(x))));
 assert.equal(b.state.settings.budget,450000);assert.deepEqual(b.state.settings.categories,['餐饮','学费']);assert.equal(b.state.settings.mode,'mobile');
 assert.deepEqual(planLegacyLedgerSettings({budget:300000,categories:['其他']},snapshot(b)),[]);
 save(b,{budget:null});ea.applyBatches(eb.pendingBatches());ea.applyBatches(eb.pendingBatches());
 assert.equal(a.state.settings.budget,null);assert.equal(a.state.settings.mode,'desktop');assert.deepEqual(a.conflicts,[]);
});
test('same initial values merge; differing concurrent budgets remain explicit conflicts',()=>{
 const a=make('a'),b=make('b'),provider=new FakeSyncProvider();save(a,{budget:10000});save(b,{budget:10000});
 new PortableSyncEngine(a,provider,hash).applyBatches(new PortableSyncEngine(b,provider,hash).pendingBatches());assert.deepEqual(a.conflicts,[]);
 const c=make('c'),d=make('d');save(c,{budget:10000});save(d,{budget:20000});
 new PortableSyncEngine(c,provider,hash).applyBatches(new PortableSyncEngine(d,provider,hash).pendingBatches());
 assert.equal(c.conflicts.length,1);assert.equal(c.state.settings.budget,null);assert.throws(()=>save(c,{budget:30000}),/UNRESOLVED_CONFLICT/);
 new AccountingService(c,'c').execute([{action:'RESOLVE_CONFLICT',entity:{type:'ledger_settings',id:'ledger-setting:budget',fields:{value:'20000'}}}]);
 assert.equal(c.state.settings.budget,20000);assert.deepEqual(c.conflicts,[]);
});
test('legacy local settings migrate only when absent; invalid settings do not partially write',()=>{
 const a=make('a');new AccountingService(a,'a').execute(p=>planLegacyLedgerSettings({budget:null,categories:['其他']},p));
 assert.equal(ledgerSettings(snapshot(a),{budget:300000}).budget,null);
 const before=a.allOperations();assert.throws(()=>save(a,{budget:90000,categories:['重复','重复']}),/INVALID_CATEGORIES/);assert.deepEqual(a.allOperations(),before);
 assert.throws(()=>save(a,{budget:0}),/INVALID_MONEY/);
});
test('SQLite stores and reloads ledger settings in schema 9',()=>{
 const db=new SqliteStore(':memory:','sql');try{
 new AccountingService(db,'sql').execute(p=>planLedgerSettings({budget:123400,categories:['学习']},p));
 assert.equal(db.db.prepare('SELECT max(version) v FROM schema_version').get()?.v,9);
 assert.equal(db.get('ledger_settings','ledger-setting:budget')?.fields.value,'123400');
 }finally{db.close();}
});
