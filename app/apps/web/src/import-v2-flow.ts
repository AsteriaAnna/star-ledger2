import {finalizeImportRefunds} from './import-refund-finalize.ts';
import type {LedgerSnapshot} from '../../../packages/accounting/index.ts';
import {ImportStatementService,type ResolveImportResult} from '../../../packages/application/import-service.ts';
import {planImportCommit,type ImportCommitPlan} from '../../../packages/application/import-commit.ts';
import {completeImportSessionFromOutcomes,importRecordOutcomes,mergeImportOutcomes,planImportExecution,type ImportExecutionPlan} from '../../../packages/application/import-execution.ts';
import {BusinessAccountingService} from '../../../packages/accounting/business.ts';
import {mutate,read} from './store.ts';
import {project} from '../../../packages/sync/projection.ts';
import {planResumeImport} from '../../../packages/application/import-resume.ts';
import {sourceReviewToken} from '../../../packages/application/import-source-attention.ts';
import type {ExternalRecord} from '../../../packages/importing/types.ts';
import type {Draft} from './importer.ts';
import {legacyDraftToExternalRecord,legacyDraftToInterpretation} from './import-v2-adapter.ts';

export type ResolvedWebImport={
 records:ExternalRecord[];
 result:ResolveImportResult;
 plan:ImportCommitPlan;
};

export async function resumeImportSession(sessionId:string){
 const state=await read();if(!state.importWorkspace)throw Error('IMPORT_SESSION_NOT_RESUMABLE');
 const plan=await planResumeImport(sessionId,state.importWorkspace,project(state.ops),new Date().toISOString());
 await mutate(store=>{
  if(!store.state.importWorkspace||sourceReviewToken(store.state.importWorkspace,{entities:store.entities,conflicts:store.conflicts})!==plan.expectedToken)throw Error('STALE_SOURCE_REVIEW');
  new BusinessAccountingService(store,store.state.device).executeBatch(plan.execution.commands);
  store.state.importWorkspace=plan.workspace;finalizeImportRefunds(store,new Date().toISOString());
 });
 return plan.session;
}

export async function resolveLegacyImportBatch(input:{
 drafts:Draft[];
 sessionId:string;
 ledger:LedgerSnapshot;
 now:string;
 service:ImportStatementService;
}):Promise<ResolvedWebImport>{
 if(!input.drafts.length)throw Error('EMPTY_IMPORT');
 const records=input.drafts.map((draft,index)=>legacyDraftToExternalRecord(draft,input.sessionId,input.now,`${input.sessionId}:observation:${index}`));
 const sourceTypes=new Set(records.map(record=>record.sourceType)),sourceSystems=new Set(records.map(record=>record.sourceSystem));
 if(sourceTypes.size!==1||sourceSystems.size!==1)throw Error('MIXED_IMPORT_SOURCE');
 const interpretations=input.drafts.map((draft,index)=>legacyDraftToInterpretation(draft,records[index]));
 const prepared=await input.service.prepare({
  sessionId:input.sessionId,sourceType:records[0].sourceType,sourceSystem:records[0].sourceSystem,
  records,interpretations,ledger:input.ledger,now:input.now
 });
 const result=await input.service.resolve({prepared,records,ledger:input.ledger,now:input.now});
 return {records,result,plan:planImportCommit(result,records)};
}


export async function commitResolvedWebImport(resolved:ResolvedWebImport,now:string):Promise<{execution:ImportExecutionPlan;session:ResolveImportResult['session']}>{
 let output:{execution:ImportExecutionPlan;session:ResolveImportResult['session']}|undefined;
 await mutate(store=>{
  const ledger={entities:store.entities,conflicts:store.conflicts};
  const execution=planImportExecution(resolved.plan,ledger,now);
  new BusinessAccountingService(store,store.state.device).executeBatch(execution.commands);
  const current=store.state.importWorkspace??{sessions:{},records:{},attention:{},outcomes:{}};
  current.outcomes??={};
  const attention=current.attention[resolved.result.session.id]??resolved.result.records.flatMap(record=>record.attention);
  const outcomes=mergeImportOutcomes(current.outcomes[resolved.result.session.id]??[],importRecordOutcomes(resolved.result.session.id,execution,now));
  const session=completeImportSessionFromOutcomes(resolved.result.session,outcomes,attention,now);
  current.sessions[session.id]=structuredClone(session);
  current.records[session.id]=structuredClone(resolved.records);
  current.attention[session.id]=structuredClone(attention);
  current.outcomes[session.id]=outcomes;
  store.state.importWorkspace=current;finalizeImportRefunds(store,now);output={execution,session:store.state.importWorkspace!.sessions[session.id]};
 });
 if(!output)throw Error('IMPORT_COMMIT_FAILED');
 return output;
}
