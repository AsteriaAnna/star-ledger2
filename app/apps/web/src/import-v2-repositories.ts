import type {AttentionItem,ExternalRecord,ImportRecordOutcome,ImportSession} from '../../../packages/importing/types.ts';
import type {ImportWorkspaceSnapshot} from '../../../packages/importing/workspace.ts';
import type {AccountIdentity,AccountMapping,CategoryMapping,ImportWorkspaceRepository,MerchantIdentity,ResolutionMemoryRepository} from '../../../packages/application/ports.ts';
import {legacyAccountMemoryMigrationCommands,readAccountMapping,readMerchantCategory,rememberAccountMappingCommand,rememberMerchantCategoryCommand} from '../../../packages/importing/resolution-memory.ts';
import {AccountingService} from '../../../packages/accounting/index.ts';
import {mutate,read} from './store.ts';
import {project} from '../../../packages/sync/projection.ts';

const empty=():ImportWorkspaceSnapshot=>({sessions:{},records:{},attention:{},outcomes:{}});
const workspace=(value:ImportWorkspaceSnapshot|undefined)=>{const next=structuredClone(value??empty()) as ImportWorkspaceSnapshot;next.outcomes??={};return next;};

export class WebImportWorkspaceRepository implements ImportWorkspaceRepository {
 async getSession(id:string){const state=await read();return structuredClone(state.importWorkspace?.sessions[id]??null);}
 async listSessions(){const state=await read();return structuredClone(Object.values(state.importWorkspace?.sessions??{}).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id)));}
 async putSession(session:ImportSession){await mutate(store=>{const next=workspace(store.state.importWorkspace);next.sessions[session.id]=structuredClone(session);store.state.importWorkspace=next;});}
 async listExternalRecords(sessionId:string){const state=await read();return structuredClone(state.importWorkspace?.records[sessionId]??[]);}
 async putExternalRecords(records:ExternalRecord[]){await mutate(store=>{
  const next=workspace(store.state.importWorkspace);
  for(const record of records){const list=next.records[record.sessionId]??[],index=list.findIndex(value=>value.id===record.id);if(index<0)list.push(structuredClone(record));else list[index]=structuredClone(record);next.records[record.sessionId]=list;}
  store.state.importWorkspace=next;
 });}
 async listAttentionItems(sessionId:string){const state=await read();return structuredClone(state.importWorkspace?.attention[sessionId]??[]);}
 async replaceAttentionItems(sessionId:string,items:AttentionItem[]){await mutate(store=>{const next=workspace(store.state.importWorkspace);next.attention[sessionId]=structuredClone(items);store.state.importWorkspace=next;});}
 async listOutcomes(sessionId:string){const state=await read();return structuredClone(state.importWorkspace?.outcomes?.[sessionId]??[]);}
 async replaceOutcomes(sessionId:string,outcomes:ImportRecordOutcome[]){if(outcomes.some(item=>item.sessionId!==sessionId))throw Error('IMPORT_SESSION_MISMATCH');await mutate(store=>{const next=workspace(store.state.importWorkspace);next.outcomes[sessionId]=structuredClone(outcomes);store.state.importWorkspace=next;});}
 async saveSessionSnapshot(session:ImportSession,records:ExternalRecord[],items:AttentionItem[]){await mutate(store=>{
  if(records.some(record=>record.sessionId!==session.id)||items.some(item=>item.sessionId!==session.id))throw Error('IMPORT_SESSION_MISMATCH');
  const next=workspace(store.state.importWorkspace);
  next.sessions[session.id]=structuredClone(session);next.records[session.id]=structuredClone(records);next.attention[session.id]=structuredClone(items);next.outcomes[session.id]??=[];
  store.state.importWorkspace=next;
 });}
 async clearSession(id:string){await mutate(store=>{const next=workspace(store.state.importWorkspace);delete next.sessions[id];delete next.records[id];delete next.attention[id];delete next.outcomes[id];store.state.importWorkspace=next;});}
}

export class LedgerResolutionMemoryRepository implements ResolutionMemoryRepository {
 private async entities(){const state=await read();return project(state.ops).entities;}
 async findAccountMapping(key:AccountIdentity):Promise<AccountMapping|null>{return readAccountMapping(await this.entities(),key);}
 async rememberAccountMapping(key:AccountIdentity,mapping:AccountMapping){await mutate(store=>{new AccountingService(store,store.state.device).execute([rememberAccountMappingCommand(store.entities,key,mapping)]);});}
 async findMerchantCategory(key:MerchantIdentity):Promise<CategoryMapping|null>{return readMerchantCategory(await this.entities(),key);}
 async rememberMerchantCategory(key:MerchantIdentity,mapping:CategoryMapping){await mutate(store=>{new AccountingService(store,store.state.device).execute([rememberMerchantCategoryCommand(store.entities,key,mapping)]);});}
}


export async function migrateLegacyResolutionMemory(now:string){
 await mutate(store=>{
  const commands=legacyAccountMemoryMigrationCommands(store.entities,now);
  if(commands.length)new AccountingService(store,store.state.device).execute(commands);
 });
}
