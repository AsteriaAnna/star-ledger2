import type {LedgerSnapshot} from '../accounting/index.ts';
import {InMemoryImportWorkspace,type ImportWorkspaceSnapshot} from '../importing/workspace.ts';
import {readAccountMapping} from '../importing/resolution-memory.ts';
import {ImportStatementService} from './import-service.ts';
import {planImportCommit} from './import-commit.ts';
import {planImportExecution,importRecordOutcomes,mergeImportOutcomes,completeImportSessionFromOutcomes} from './import-execution.ts';
import {sourceReviewToken} from './import-source-attention.ts';

/** Rebuilds only from captured interpretations, never from a newer parser. */
export async function planResumeImport(sessionId:string,workspace:ImportWorkspaceSnapshot,ledger:LedgerSnapshot,now:string){
 const expectedToken=sourceReviewToken(workspace,ledger),session=workspace.sessions[sessionId];
 if(!session||!['PROCESSING','FAILED'].includes(session.state))throw Error('IMPORT_SESSION_NOT_RESUMABLE');
 const records=workspace.records[sessionId]??[],interpretations=workspace.interpretations?.[sessionId]??[];
 if(!records.length||interpretations.length!==records.length||records.some(r=>!interpretations.some(i=>i.externalRecordId===r.id)))throw Error('IMPORT_INTERPRETATION_UNAVAILABLE');
 const memory=new InMemoryImportWorkspace(workspace);
 await memory.putSession({...session,state:'PROCESSING',failureCode:null});
 const service=new ImportStatementService(memory,{findAccountMapping:async key=>readAccountMapping(ledger.entities,key),rememberAccountMapping:async()=>{},findMerchantCategory:async()=>null,rememberMerchantCategory:async()=>{}});
 const prepared=await service.prepare({sessionId,sourceType:session.sourceType,sourceSystem:session.sourceSystem,records,interpretations,ledger,now});
 const resolved=await service.resolve({prepared,records,ledger,now});
 const execution=planImportExecution(planImportCommit(resolved,records),ledger,now);
 const next=memory.snapshot(),attention=next.attention[sessionId];
 next.outcomes[sessionId]=mergeImportOutcomes(workspace.outcomes[sessionId]??[],importRecordOutcomes(sessionId,execution,now));
 next.sessions[sessionId]=completeImportSessionFromOutcomes(resolved.session,next.outcomes[sessionId],attention,now);
 return {expectedToken,execution,workspace:next,session:next.sessions[sessionId]};
}
