import type {CaptureJob} from './capture-jobs.ts';
import {readPersistedCaptureEvidence} from '../../../packages/importing/persisted-capture-evidence.ts';
import {validateCaptureReferences,mergeCaptureEvidence} from '../../../packages/importing/capture-evidence.ts';
import {ledgerSettings,planLedgerSettings,planLegacyLedgerSettings} from '../../../packages/application/ledger-settings.ts';
import type {Operation,Entity,EntityType,Batch,Conflict,FieldVersion} from '../../../packages/domain/index.ts';
import type {SyncStore} from '../../../packages/platform/ports.ts';
import type {BusinessCommand} from '../../../packages/domain/accounting.ts';
import {AccountingService,type Command} from '../../../packages/accounting/index.ts';
import {BusinessAccountingService} from '../../../packages/accounting/business.ts';
import {project} from '../../../packages/sync/projection.ts';
import {PortableSyncEngine,FakeSyncProvider} from '../../../packages/sync/core.ts';
import type {Draft} from './importer.ts';
import {hash} from './normalize.ts';
export {hash} from './normalize.ts';
import type {EncryptedProvider} from '../../../packages/sync/github.ts';
import {webSessionCrypto} from '../../../packages/platform/web-crypto.ts';
import type {ImportWorkspaceSnapshot} from '../../../packages/importing/workspace.ts';
export function validateImportWorkspace(value:unknown):ImportWorkspaceSnapshot{
 if(!value||typeof value!=='object')throw Error('备份导入恢复状态格式无效');
 const v=value as any;if(!v.sessions||!v.records||!v.attention||typeof v.sessions!=='object'||typeof v.records!=='object'||typeof v.attention!=='object')throw Error('备份导入恢复状态格式无效');
 const sessions=Object.values(v.sessions) as any[];if(sessions.length>1000)throw Error('备份导入恢复状态过大');
 for(const s of sessions)if(!s||typeof s.id!=='string'||typeof s.updatedAt!=='string'||!['PROCESSING','NEEDS_ATTENTION','COMPLETED','FAILED','ROLLED_BACK'].includes(s.state))throw Error('备份导入恢复状态格式无效');
 const ids=new Set(sessions.map(s=>s.id));let count=0;
 for(const [id,records] of Object.entries(v.records) as [string,any[]][]){if(!ids.has(id)||!Array.isArray(records)||(count+=records.length)>20000||records.some(r=>!r||r.sessionId!==id||typeof r.id!=='string'||typeof r.rawPayload!=='string'))throw Error('备份导入恢复状态格式无效');}
 for(const [id,items] of Object.entries(v.attention) as [string,any[]][]){if(!ids.has(id)||!Array.isArray(items)||items.some(a=>!a||a.sessionId!==id||typeof a.id!=='string'||typeof a.question!=='string'))throw Error('备份导入恢复状态格式无效');}
 const outcomes=v.outcomes??{};if(typeof outcomes!=='object')throw Error('备份导入恢复状态格式无效');
 for(const [id,items] of Object.entries(outcomes) as [string,any[]][]){if(!ids.has(id)||!Array.isArray(items)||items.some(o=>!o||o.sessionId!==id||typeof o.externalRecordId!=='string'||!['COMMITTED','SKIPPED_DUPLICATE','NO_EFFECT','BLOCKED'].includes(o.state)))throw Error('备份导入恢复状态格式无效');}
 const interpretations=v.interpretations??{};if(!interpretations||typeof interpretations!=='object'||Array.isArray(interpretations))throw Error('备份解释格式无效');
 for(const [id,items] of Object.entries(interpretations) as [string,any[]][]){const recordIds=new Set((v.records[id]??[]).map((r:any)=>r.id));if(!ids.has(id)||!Array.isArray(items)||new Set(items.map(i=>i?.externalRecordId)).size!==items.length||items.some(i=>!i||!recordIds.has(i.externalRecordId)||typeof i.eventKind!=='string'||!['SUCCESS','PENDING','FAILED','UNKNOWN'].includes(i.status)||(i.amountFen!==null&&!Number.isSafeInteger(i.amountFen))||(i.occurredAt!==null&&typeof i.occurredAt!=='string')||typeof i.displayName!=='string'||!Array.isArray(i.evidence)))throw Error('备份解释格式无效');}
 const captures=v.captureEvidence??{};if(!captures||typeof captures!=='object'||Array.isArray(captures))throw Error('INVALID_CAPTURE_BACKUP');
 for(const [id,evidence] of Object.entries(captures)){if(!ids.has(id)||!Array.isArray(evidence))throw Error('INVALID_CAPTURE_BACKUP');validateCaptureReferences(v.records[id]??[],evidence);}
 for(const [id,records] of Object.entries(v.records))validateCaptureReferences(records as any[],captures[id]??[]);
 return structuredClone({...v,outcomes,...(v.interpretations?{interpretations}:{})}) as ImportWorkspaceSnapshot;
}
function mergeImportWorkspace(current:ImportWorkspaceSnapshot|undefined,incoming:ImportWorkspaceSnapshot){
 const out=structuredClone(current??{sessions:{},records:{},attention:{},outcomes:{}});
 for(const [id,session] of Object.entries(incoming.sessions)){
  const existing=out.sessions[id];if(existing&&existing.updatedAt>=session.updatedAt)continue;
  out.interpretations??={};out.interpretations[id]=structuredClone(incoming.interpretations?.[id]??[]);
  if(incoming.captureEvidence?.[id]){out.captureEvidence??={};out.captureEvidence[id]=mergeCaptureEvidence(out.captureEvidence[id]??[],incoming.captureEvidence[id]);}
  out.sessions[id]=structuredClone(session);out.records[id]=structuredClone(incoming.records[id]??[]);out.attention[id]=structuredClone(incoming.attention[id]??[]);out.outcomes[id]=structuredClone(incoming.outcomes?.[id]??[]);
 }
 return out;
}
export type State={captureJobs?:Record<string,CaptureJob>;cloud?:{uid:string;ledger:string;recoveryKey:string};version:2;imports?:Draft[];importRevision?:number;importWorkspace?:ImportWorkspaceSnapshot;revision:number;device:string;ops:Operation[];pending:string[];batches:{device:string;seq:number;checksum:string}[];envelopes:Record<string,string>;settings:Record<string,any>};
export const fresh=():State=>({version:2,imports:[],importRevision:0,importWorkspace:{sessions:{},records:{},attention:{},outcomes:{}},revision:0,device:crypto.randomUUID(),ops:[],pending:[],batches:[],envelopes:{},settings:{budget:300000,categories:['餐饮','购物','交通','生活','娱乐','学习','医疗','其他'],mode:'auto'}});
export class MemoryStore implements SyncStore {
 state:State;entities:Entity[];conflicts:Conflict[];
 constructor(state:State){this.state=structuredClone(state);const p=project(state.ops);readPersistedCaptureEvidence(p.entities);this.entities=p.entities;this.conflicts=p.conflicts;this.state.settings=ledgerSettings(p,this.state.settings);}
 atomic<T>(fn:()=>T):T{const s=structuredClone(this.state),e=this.entities,c=this.conflicts;try{return fn();}catch(err){this.state=s;this.entities=e;this.conflicts=c;throw err;}}
 allOperations(){return structuredClone(this.state.ops);}
 append(op:Operation,local:boolean){this.state.ops.push(structuredClone(op));if(local)this.state.pending.push(op.id);}
 project(entities:Entity[],conflicts:Conflict[],_v:FieldVersion[]){readPersistedCaptureEvidence(entities);this.entities=entities;this.conflicts=conflicts;this.state.settings=ledgerSettings({entities,conflicts},this.state.settings);}
 get(type:EntityType,id:string){return this.entities.find(e=>e.type===type&&e.id===id);}
 pendingOperations(){const ids=new Set(this.state.pending);return this.state.ops.filter(o=>ids.has(o.id));}
 acknowledgeOperations(ids:string[]){const set=new Set(ids);this.state.pending=this.state.pending.filter(id=>!set.has(id));}
 recordBatches(b:Batch[]){const m=new Map(this.state.batches.map(x=>[`${x.device}:${x.seq}`,x]));b.forEach(x=>m.set(`${x.device}:${x.seq}`,{device:x.device,seq:x.seq,checksum:x.checksum}));this.state.batches=[...m.values()];}
 knownBatches(){return this.state.batches;}
 getEnvelope(id:string){return this.state.envelopes[id];}
 saveEnvelopeIfAbsent(id:string,e:string){return this.state.envelopes[id]??(this.state.envelopes[id]=e);}
 acknowledgedEnvelopes(){return Object.entries(this.state.envelopes).filter(([id])=>!this.state.ops.some(o=>o.command_id===id&&this.state.pending.includes(o.id))).map(([,e])=>e);}
}
let db:IDBDatabase;let queue=Promise.resolve();let activeLedgerKey='main';
export function assertLocalLedgerOwner(uid:string){if(activeLedgerKey!==ownerKey(uid))throw Error('CLOUD_OWNER_MISMATCH');}
const ownerKey=(owner:string|null)=>owner?'cloudbase:'+encodeURIComponent(owner):'main';
export async function openStore(owner:string|null=null){activeLedgerKey=ownerKey(owner);db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('star-ledger-next-v1',2);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('ledger'))r.result.createObjectStore('ledger');};r.onblocked=()=>reject(Error('请关闭其他星账页面，再重新打开以完成升级'));r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result);};r.onerror=()=>reject(r.error);});const current=await read();if(!current)await write(fresh(),-1);else if(Number(current.version)<2)await write({...current,version:2,imports:[],importRevision:0},current.revision);else if(current.version!==2)throw Error('不支持此数据版本，请更新星账');}
export async function read():Promise<State>{return new Promise((resolve,reject)=>{const r=db.transaction('ledger').objectStore('ledger').get(activeLedgerKey);r.onsuccess=()=>{try{const state=r.result;if(state)state.settings=ledgerSettings(project(state.ops),state.settings);resolve(state);}catch(e){reject(e);}};r.onerror=()=>reject(r.error);});}
async function write(state:State,expected:number){return new Promise<void>((resolve,reject)=>{const tx=db.transaction('ledger','readwrite');const s=tx.objectStore('ledger');const r=s.get(activeLedgerKey);let reason:Error|undefined;r.onsuccess=()=>{if((r.result?.revision??-1)!==expected){reason=Error('账本已在其他窗口更新，请重试');tx.abort();return;}s.put({...state,revision:expected+1},activeLedgerKey);};tx.oncomplete=()=>{resolve();if(typeof window!=='undefined')window.dispatchEvent(new Event('ledger-saved'));};tx.onabort=()=>reject(reason??tx.error??Error('保存失败'));tx.onerror=()=>reject(tx.error);});}
export function exclusive<T>(fn:()=>Promise<T>):Promise<T>{const run=()=>navigator.locks?navigator.locks.request('star-ledger-next-write',fn):fn();const p=queue.then(run,run);queue=p.then(()=>{},()=>{});return p;}
export async function selectLocalLedger(owner:string|null){return exclusive(async()=>{const previous=activeLedgerKey;activeLedgerKey=ownerKey(owner);try{if(!await read())await write(fresh(),-1);}catch(error){activeLedgerKey=previous;throw error;}});}
export async function mutate(fn:(store:MemoryStore)=>void){return exclusive(async()=>{const s=await read();const store=new MemoryStore(s);fn(store);await write(store.state,s.revision);});}
export async function business(command:BusinessCommand){return mutate(s=>{new BusinessAccountingService(s,s.state.device).execute(command);});}
export async function raw(commands:Command[]){return mutate(s=>{new AccountingService(s,s.state.device).execute(commands);});}
export async function settings(values:Record<string,any>){return mutate(s=>{new AccountingService(s,s.state.device).execute(snapshot=>planLedgerSettings(values,snapshot));const local=Object.fromEntries(Object.entries(values).filter(([key])=>!['budget','categories'].includes(key)));Object.assign(s.state.settings,local);});}
export async function saveImports(items:Draft[],expected:number){return mutate(s=>{if((s.state.importRevision||0)!==expected)throw Error('导入队列已在另一窗口更新，请刷新后重试');s.state.imports=structuredClone(items);s.state.importRevision=expected+1;});}
function serializeBackup(s:State){return JSON.stringify({format:'star-ledger-web-backup',version:3,imports:s.imports||[],importWorkspace:s.importWorkspace??{sessions:{},records:{},attention:{},outcomes:{}},exportedAt:new Date().toISOString(),operations:s.ops,settings:s.settings},null,2);}
export async function backup(){return serializeBackup(await read());}

export async function restore(text:string){const b=JSON.parse(text);if(b.format!=='star-ledger-web-backup'||![1,2,3].includes(b.version)||!Array.isArray(b.operations)||b.operations.length>100000)throw Error('不是有效的星账新版备份');return mutate(s=>{const groups=new Map<string,Operation[]>();for(const op of b.operations){const g=groups.get(op.command_id)??[];g.push(op);groups.set(op.command_id,g);}const batches=[...groups.values()].map(ops=>{ops.sort((a,b)=>a.command_index-b.command_index);const body={version:1 as const,device:ops[0].device,seq:ops[0].seq,operations:ops};return {...body,checksum:hash(body)};});const accepted=structuredClone(s.state.batches);new PortableSyncEngine(s,new FakeSyncProvider(),hash).applyBatches(batches);s.state.batches=accepted;s.state.pending=[...new Set([...s.state.pending,...s.state.ops.map(o=>o.id)])];if(b.version>=2&&Array.isArray(b.imports)){if(b.imports.length>10000||!b.imports.every((d:any)=>d&&typeof d.key==='string'&&typeof d.raw==='string'&&['name','kind','status','date','amount','channel','platform','account','to','original','note','category'].every(k=>typeof d[k]==='string')&&(!d.blockers||Array.isArray(d.blockers)&&d.blockers.every((v:unknown)=>typeof v==='string'))&&(!d.confirmed||Array.isArray(d.confirmed)&&d.confirmed.every((v:unknown)=>typeof v==='string'))))throw Error('备份待办格式无效');const known=new Set((s.state.imports||[]).map(d=>d.itemId||d.key));s.state.imports=[...(s.state.imports||[]),...b.imports.filter((d:Draft)=>!known.has(d.itemId||d.key))];s.state.importRevision=(s.state.importRevision||0)+1;}if(b.version===3&&b.importWorkspace)s.state.importWorkspace=mergeImportWorkspace(s.state.importWorkspace,validateImportWorkspace(b.importWorkspace));if(b.settings&&typeof b.settings==='object'){const {budget,categories}=b.settings;if(budget===null||(Number.isSafeInteger(budget)&&budget>0))s.state.settings.budget=budget;if(Array.isArray(categories)&&categories.every(c=>typeof c==='string'&&c.length<60))s.state.settings.categories=categories;}});}
export async function synchronizeEncrypted(config:{provider:EncryptedProvider;ledger:string;key:string;target:string;metadata?:Record<string,string>;uid?:string},progress:(s:string)=>void){return exclusive(async()=>{
 let state=await read();const target=config.target;
 if(config.uid&&(state.cloud?.uid!==config.uid||state.cloud?.ledger!==config.ledger||state.cloud?.recoveryKey!==config.key))throw Error('CLOUD_OWNER_MISMATCH');
 if(state.settings.syncTarget&&state.settings.syncTarget!==target)throw Error('此账本与当前云同步位置不一致，请重新登录正确的账户。');
 const provider=config.provider;const cipher=await webSessionCrypto(config.ledger,config.key);await provider.healthCheck();
 // Persist every ciphertext before upload, and every acknowledgement after the remote write.
 let store=new MemoryStore(state);
 progress('先核验已有远端记录');const priorFiles=await provider.list();const priorBatches:Batch[]=[];const priorEnvelopes=new Map<string,string>();
 const remotePath=(b:Batch)=>`ledger-sync/${config.ledger}/${b.device}/${String(b.seq).padStart(16,'0')}.json`;
 for(const f of priorFiles){const envelope=await provider.download(f);const b=await cipher.open(envelope);if(remotePath(b)!==f.path)throw Error('REMOTE_PATH_MISMATCH');priorBatches.push(b);priorEnvelopes.set(b.operations[0]?.command_id,envelope);}
 for(const known of store.knownBatches())if(!priorBatches.some(b=>b.device===known.device&&b.seq===known.seq&&b.checksum===known.checksum))throw Error('REMOTE_HISTORY_MISSING');
 new PortableSyncEngine(store,new FakeSyncProvider(),hash).applyBatches(priorBatches);
 for(const b of priorBatches){store.acknowledgeOperations(b.operations.map(o=>o.id));}
 const settingCommands=planLegacyLedgerSettings(state.settings,{entities:store.entities,conflicts:store.conflicts});if(settingCommands.length)new AccountingService(store,store.state.device).execute(settingCommands);
 store.state.settings.syncTarget=target;
 await write(store.state,state.revision);state=await read();store=new MemoryStore(state);
 const core=new PortableSyncEngine(store,new FakeSyncProvider(),hash);
 const pending=core.pendingBatches();
 const path=(b:Batch)=>`ledger-sync/${config.ledger}/${b.device}/${String(b.seq).padStart(16,'0')}.json`;
 for(let i=0;i<pending.length;i++){const b=pending[i];progress(`上传 ${i+1} / ${pending.length}`);let e=store.getEnvelope(b.operations[0].command_id);if(!e){e=await cipher.seal(b);store.saveEnvelopeIfAbsent(b.operations[0].command_id,e);await write(store.state,state.revision);state=await read();store=new MemoryStore(state);}else await cipher.open(e);
 await provider.upload(path(b),e);store.acknowledgeOperations(b.operations.map(o=>o.id));await write(store.state,state.revision);state=await read();store=new MemoryStore(state);}
 progress('核验并下载远端记录');const files=await provider.list();const batches:Batch[]=[];
 for(const f of files){const b=await cipher.open(await provider.download(f));if(path(b)!==f.path)throw Error('REMOTE_PATH_MISMATCH');batches.push(b);}
 for(const e of store.acknowledgedEnvelopes()){const b=await cipher.open(e);if(!batches.some(r=>r.device===b.device&&r.seq===b.seq&&r.checksum===b.checksum))throw Error('UPLOADED_HISTORY_MISSING');}
 for(const known of store.knownBatches())if(!batches.some(b=>b.device===known.device&&b.seq===known.seq&&b.checksum===known.checksum))throw Error('REMOTE_HISTORY_MISSING');
 new PortableSyncEngine(store,new FakeSyncProvider(),hash).applyBatches(batches);Object.assign(store.state.settings,{syncTarget:target,syncConfig:config.metadata,lastSync:new Date().toISOString()});await write(store.state,state.revision);
 });}
