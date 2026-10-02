import type {AttentionItem,ExternalRecord,ImportSession} from './types.ts';
import type {ImportWorkspaceRepository} from '../application/ports.ts';

export type ImportWorkspaceSnapshot={
 sessions:Record<string,ImportSession>;
 records:Record<string,ExternalRecord[]>;
 attention:Record<string,AttentionItem[]>;
};

export class InMemoryImportWorkspace implements ImportWorkspaceRepository {
 private data:ImportWorkspaceSnapshot;
 constructor(seed?:Partial<ImportWorkspaceSnapshot>){
  this.data={sessions:structuredClone(seed?.sessions??{}),records:structuredClone(seed?.records??{}),attention:structuredClone(seed?.attention??{})};
 }
 async getSession(id:string){return structuredClone(this.data.sessions[id]??null);}
 async putSession(session:ImportSession){this.data.sessions[session.id]=structuredClone(session);}
 async listExternalRecords(sessionId:string){return structuredClone(this.data.records[sessionId]??[]);}
 async putExternalRecords(records:ExternalRecord[]){
  for(const record of records){
   const list=this.data.records[record.sessionId]??[];
   const index=list.findIndex(x=>x.id===record.id);
   if(index<0)list.push(structuredClone(record));else list[index]=structuredClone(record);
   this.data.records[record.sessionId]=list;
  }
 }
 async listAttentionItems(sessionId:string){return structuredClone(this.data.attention[sessionId]??[]);}
 async replaceAttentionItems(sessionId:string,items:AttentionItem[]){this.data.attention[sessionId]=structuredClone(items);}
 async saveSessionSnapshot(session:ImportSession,records:ExternalRecord[],items:AttentionItem[]){
  if(records.some(record=>record.sessionId!==session.id)||items.some(item=>item.sessionId!==session.id))throw Error('IMPORT_SESSION_MISMATCH');
  const next=structuredClone(this.data);next.sessions[session.id]=structuredClone(session);next.records[session.id]=structuredClone(records);next.attention[session.id]=structuredClone(items);this.data=next;
 }
 async clearSession(id:string){delete this.data.sessions[id];delete this.data.records[id];delete this.data.attention[id];}
 snapshot(){return structuredClone(this.data);}
}


export interface WorkspaceStorage {
 getItem(key:string):string|null;
 setItem(key:string,value:string):void;
 removeItem(key:string):void;
}

/**
 * Device-local V2 import recovery state.
 * The entire workspace is one serialized value so saveSessionSnapshot cannot
 * expose a session whose records/attention still belong to an older revision.
 * This repository is deliberately outside Operation/GitHub sync.
 */
export class LocalImportWorkspace implements ImportWorkspaceRepository {
 private readonly memory:InMemoryImportWorkspace;
 constructor(private readonly storage:WorkspaceStorage,private readonly key='star-ledger:v2:import-workspace'){
  let seed:ImportWorkspaceSnapshot|undefined;
  const raw=storage.getItem(key);
  if(raw){try{seed=JSON.parse(raw) as ImportWorkspaceSnapshot;}catch{storage.removeItem(key);}}
  this.memory=new InMemoryImportWorkspace(seed);
 }
 private persist(){this.storage.setItem(this.key,JSON.stringify(this.memory.snapshot()));}
 async getSession(id:string){return this.memory.getSession(id);}
 async putSession(session:ImportSession){await this.memory.putSession(session);this.persist();}
 async listExternalRecords(sessionId:string){return this.memory.listExternalRecords(sessionId);}
 async putExternalRecords(records:ExternalRecord[]){await this.memory.putExternalRecords(records);this.persist();}
 async listAttentionItems(sessionId:string){return this.memory.listAttentionItems(sessionId);}
 async replaceAttentionItems(sessionId:string,items:AttentionItem[]){await this.memory.replaceAttentionItems(sessionId,items);this.persist();}
 async saveSessionSnapshot(session:ImportSession,records:ExternalRecord[],items:AttentionItem[]){
  await this.memory.saveSessionSnapshot(session,records,items);this.persist();
 }
 async clearSession(id:string){await this.memory.clearSession(id);this.persist();}
}
