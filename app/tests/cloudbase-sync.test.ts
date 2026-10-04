import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {CloudBaseSyncProvider} from '../packages/sync/cloudbase.ts';
const {handleRequest,ledgerFor,prefixFor}=createRequire(import.meta.url)('../cloudbase/functions/star-ledger-sync/protocol.cjs');
function fixture(){const rows=new Map<string,any>(),repo={get:async(id:string)=>rows.get(id)||null,list:async(prefix:string,cursor:string|undefined,limit:number)=>[...rows.values()].filter(r=>r._id>(cursor||prefix)&&r._id<prefix+'~').sort((a,b)=>a._id.localeCompare(b._id)).slice(0,limit),insertImmutable:async(row:any)=>{const old=rows.get(row._id);if(old&&old.content!==row.content)throw Error('REMOTE_COLLISION');rows.set(row._id,row);}};return {rows,repo};}
const content=(ledger:string,seq=1)=>JSON.stringify({format:1,protocol:2,ledger,device:'device',seq,ciphertext:'encrypted',nonce:'nonce',tag:'tag'});
test('cloud users cannot request another namespace or impersonate event.uid',async()=>{
 const {repo}=fixture(),a=ledgerFor('A'),b=ledgerFor('B');await assert.rejects(handleRequest({action:'HEALTH',ledger:a,uid:'A'},'B',repo),/CLOUD_OWNER_MISMATCH/);await assert.rejects(handleRequest({action:'HEALTH',ledger:a},null,repo),/CLOUD_AUTH_REQUIRED/);
 const own=await handleRequest({action:'HEALTH',ledger:b,uid:'A'},'B',repo);assert.deepEqual(own,{uid:'B',ledger:b});
});
test('encrypted upload retries are idempotent and another user sees no files or recovery vault',async()=>{
 const {repo,rows}=fixture(),ledger=ledgerFor('A'),provider=new CloudBaseSyncProvider(data=>handleRequest(data,'A',repo),'A',ledger),path=`ledger-sync/${ledger}/device/0000000000000001.json`;
 await provider.healthCheck();await provider.upload(path,content(ledger));await provider.upload(path,content(ledger));assert.equal(rows.size,1);const [file]=await provider.list();assert.equal(await provider.download(file),content(ledger));await assert.rejects(provider.upload(path,content(ledger).replace('encrypted','changed')),/REMOTE_COLLISION/);
 await provider.putWrappedKey('opaque-password-wrapped-key');assert.equal(await provider.getWrappedKey(),'opaque-password-wrapped-key');const other=new CloudBaseSyncProvider(data=>handleRequest(data,'B',repo),'B',ledgerFor('B'));assert.deepEqual(await other.list(),[]);assert.equal(await other.getWrappedKey(),null);await assert.rejects(other.download(file),/INVALID_REMOTE_PATH/);
});
test('cloud provider paginates metadata, excluding the key vault from bill files',async()=>{
 const {repo,rows}=fixture(),ledger=ledgerFor('A'),provider=new CloudBaseSyncProvider(data=>handleRequest(data,'A',repo),'A',ledger);for(let i=1;i<=105;i++)await provider.upload(`ledger-sync/${ledger}/device/${String(i).padStart(16,'0')}.json`,content(ledger,i));await provider.putWrappedKey('wrapped');assert.equal((await provider.list()).length,105);assert.equal(rows.size,106);assert.ok([...rows.keys()].every(id=>id.startsWith(prefixFor('A'))));
});

test('two clients restore the same encrypted ledger, budget and aliases through the CloudBase adapter',async()=>{
 const {MemoryStore,fresh}=await import('../apps/web/src/store.ts'),{BusinessAccountingService}=await import('../packages/accounting/business.ts'),{AccountingService}=await import('../packages/accounting/index.ts'),{PortableSyncEngine,FakeSyncProvider}=await import('../packages/sync/core.ts'),{PortableSecureSyncEngine}=await import('../packages/sync/secure-core.ts'),{webSessionCrypto}=await import('../packages/platform/web-crypto.ts'),{createRecoveryKey,wrapRecoveryKey,unwrapRecoveryKey}=await import('../packages/platform/password-key.ts'),{planLedgerSettings}=await import('../packages/application/ledger-settings.ts'),{rememberAccountMappingCommand}=await import('../packages/importing/resolution-memory.ts'),{hash}=await import('../apps/web/src/normalize.ts');
 const {repo}=fixture(),ledger=ledgerFor('A'),remote=()=>new CloudBaseSyncProvider(data=>handleRequest(data,'A',repo),'A',ledger),first=new MemoryStore(fresh()),second=new MemoryStore(fresh()),key=createRecoveryKey();
 await remote().putWrappedKey(await wrapRecoveryKey(key,'test-password','A',ledger));const restored=await unwrapRecoveryKey((await remote().getWrappedKey())!,'test-password','A',ledger);
 const business=new BusinessAccountingService(first,first.state.device);business.execute({kind:'CREATE_ACCOUNT',id:'wallet',name:'我的零钱',accountType:'ASSET',openingBalance:null,openingBalanceAt:'2026-10-01T00:00:00Z'});business.execute({kind:'PURCHASE',id:'p',name:'消费',amount:1234,payer:'wallet',occurredAt:'2026-10-02T00:00:00Z'});
 new AccountingService(first,first.state.device).execute([...planLedgerSettings({budget:123456,categories:['餐饮','其他']},{entities:first.entities,conflicts:[]}),rememberAccountMappingCommand(first.entities,{sourceSystem:'WECHAT',profile:'本人',channelKey:'微信:零钱',role:'PRIMARY'},{accountId:'wallet',rememberedAt:'2026-10-02T00:00:00Z'})]);
 const sync=async(store:InstanceType<typeof MemoryStore>,key:string)=>new PortableSecureSyncEngine(store,remote(),ledger,await webSessionCrypto(ledger,key),new PortableSyncEngine(store,new FakeSyncProvider(),hash)).sync();
 await sync(first,key);await sync(second,restored);assert.equal(second.entities.find(e=>e.type==='transactions'&&e.id==='p')?.fields.display_amount,1234);assert.equal(second.state.settings.budget,123456);assert.deepEqual(second.state.settings.categories,['餐饮','其他']);assert.equal(second.entities.filter(e=>e.type==='import_rules').length,1);
 new BusinessAccountingService(second,second.state.device).execute({kind:'PURCHASE',id:'second',name:'另一设备消费',amount:500,payer:'wallet',occurredAt:'2026-10-03T00:00:00Z'});await sync(second,restored);await sync(first,key);assert.equal(first.entities.filter(e=>e.type==='transactions').length,2);assert.equal(first.state.pending.length,0);assert.equal(second.state.pending.length,0);
});
