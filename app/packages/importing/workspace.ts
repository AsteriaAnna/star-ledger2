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
 async clearSession(id:string){delete this.data.sessions[id];delete this.data.records[id];delete this.data.attention[id];}
 snapshot(){return structuredClone(this.data);}
}
