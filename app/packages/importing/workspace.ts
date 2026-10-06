import type {AttentionItem,CaptureEvidence,EventInterpretation,ExternalRecord,ImportRecordOutcome,ImportSession} from './types.ts';
import {mergeCaptureEvidence,validateCaptureReferences} from './capture-evidence.ts';
import type {ImportWorkspaceRepository} from '../application/ports.ts';

export type ImportWorkspaceSnapshot={
 interpretations?:Record<string,EventInterpretation[]>;
 captureEvidence?:Record<string,CaptureEvidence[]>;
 sessions:Record<string,ImportSession>;
 records:Record<string,ExternalRecord[]>;
 attention:Record<string,AttentionItem[]>;
 outcomes:Record<string,ImportRecordOutcome[]>;
};

export function applyCaptureSessionEvidence(snapshot:ImportWorkspaceSnapshot,sessionId:string,records:ExternalRecord[],incoming?:CaptureEvidence[]){
 const evidence=mergeCaptureEvidence(snapshot.captureEvidence?.[sessionId]??[],incoming??[]);
 validateCaptureReferences(records,evidence);
 if(incoming||snapshot.captureEvidence?.[sessionId]){snapshot.captureEvidence??={};snapshot.captureEvidence[sessionId]=evidence;}
}

export class InMemoryImportWorkspace implements ImportWorkspaceRepository {
 private data:ImportWorkspaceSnapshot;
 constructor(seed?:Partial<ImportWorkspaceSnapshot>){
  this.data={...(seed?.captureEvidence?{captureEvidence:structuredClone(seed.captureEvidence)}:{}),interpretations:structuredClone(seed?.interpretations??{}),sessions:structuredClone(seed?.sessions??{}),records:structuredClone(seed?.records??{}),attention:structuredClone(seed?.attention??{}),outcomes:structuredClone(seed?.outcomes??{})};
  for(const [id,records] of Object.entries(this.data.records))validateCaptureReferences(records,this.data.captureEvidence?.[id]??[]);
 }
 async getSession(id:string){return structuredClone(this.data.sessions[id]??null);}
 async listSessions(){return structuredClone(Object.values(this.data.sessions).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.id.localeCompare(b.id)));}
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
 async listCaptureEvidence(sessionId:string){return structuredClone(this.data.captureEvidence?.[sessionId]??[]);}
 async listAttentionItems(sessionId:string){return structuredClone(this.data.attention[sessionId]??[]);}
 async replaceAttentionItems(sessionId:string,items:AttentionItem[]){this.data.attention[sessionId]=structuredClone(items);}
 async listOutcomes(sessionId:string){return structuredClone(this.data.outcomes[sessionId]??[]);}
 async replaceOutcomes(sessionId:string,outcomes:ImportRecordOutcome[]){if(outcomes.some(item=>item.sessionId!==sessionId))throw Error('IMPORT_SESSION_MISMATCH');this.data.outcomes[sessionId]=structuredClone(outcomes);}
 async saveSessionSnapshot(session:ImportSession,records:ExternalRecord[],items:AttentionItem[],interpretations?:EventInterpretation[],captureEvidence?:CaptureEvidence[]){
  if(records.some(record=>record.sessionId!==session.id)||items.some(item=>item.sessionId!==session.id))throw Error('IMPORT_SESSION_MISMATCH');
  const next=structuredClone(this.data);applyCaptureSessionEvidence(next,session.id,records,captureEvidence);next.sessions[session.id]=structuredClone(session);next.records[session.id]=structuredClone(records);next.attention[session.id]=structuredClone(items);if(interpretations){next.interpretations??={};next.interpretations[session.id]=structuredClone(interpretations);}this.data=next;
 }
 async clearSession(id:string){delete this.data.captureEvidence?.[id];delete this.data.interpretations?.[id];delete this.data.sessions[id];delete this.data.records[id];delete this.data.attention[id];delete this.data.outcomes[id];}
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
 private memory:InMemoryImportWorkspace;
 private readonly storage:WorkspaceStorage;
 private readonly key:string;
 constructor(storage:WorkspaceStorage,key='star-ledger:v2:import-workspace'){
  this.storage=storage;this.key=key;
  let seed:ImportWorkspaceSnapshot|undefined;
  const raw=storage.getItem(key);
  if(raw){try{seed=JSON.parse(raw) as ImportWorkspaceSnapshot;}catch{throw Error('CORRUPT_IMPORT_WORKSPACE');}}
  this.memory=new InMemoryImportWorkspace(seed);
 }
 private persist(){this.storage.setItem(this.key,JSON.stringify(this.memory.snapshot()));}
 async getSession(id:string){return this.memory.getSession(id);}
 async listSessions(){return this.memory.listSessions();}
 async putSession(session:ImportSession){await this.memory.putSession(session);this.persist();}
 async listExternalRecords(sessionId:string){return this.memory.listExternalRecords(sessionId);}
 async putExternalRecords(records:ExternalRecord[]){await this.memory.putExternalRecords(records);this.persist();}
 async listCaptureEvidence(sessionId:string){return this.memory.listCaptureEvidence(sessionId);}
 async listAttentionItems(sessionId:string){return this.memory.listAttentionItems(sessionId);}
 async replaceAttentionItems(sessionId:string,items:AttentionItem[]){await this.memory.replaceAttentionItems(sessionId,items);this.persist();}
 async listOutcomes(sessionId:string){return this.memory.listOutcomes(sessionId);}
 async replaceOutcomes(sessionId:string,outcomes:ImportRecordOutcome[]){await this.memory.replaceOutcomes(sessionId,outcomes);this.persist();}
 async saveSessionSnapshot(session:ImportSession,records:ExternalRecord[],items:AttentionItem[],interpretations?:EventInterpretation[],captureEvidence?:CaptureEvidence[]){
  const next=new InMemoryImportWorkspace(this.memory.snapshot());
  await next.saveSessionSnapshot(session,records,items,interpretations,captureEvidence);
  this.storage.setItem(this.key,JSON.stringify(next.snapshot()));this.memory=next;
 }
 async clearSession(id:string){await this.memory.clearSession(id);this.persist();}
}
