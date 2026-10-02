import type {LedgerSnapshot} from '../../../packages/accounting/index.ts';
import {ImportStatementService,type ResolveImportResult} from '../../../packages/application/import-service.ts';
import {planImportCommit,type ImportCommitPlan} from '../../../packages/application/import-commit.ts';
import {completeImportSession,importRecordOutcomes,planImportExecution,type ImportExecutionPlan} from '../../../packages/application/import-execution.ts';
import {BusinessAccountingService} from '../../../packages/accounting/business.ts';
import {mutate} from './store.ts';
import type {ExternalRecord} from '../../../packages/importing/types.ts';
import type {Draft} from './importer.ts';
import {legacyDraftToExternalRecord,legacyDraftToInterpretation} from './import-v2-adapter.ts';

export type ResolvedWebImport={
 records:ExternalRecord[];
 result:ResolveImportResult;
 plan:ImportCommitPlan;
};

export async function resolveLegacyImportBatch(input:{
 drafts:Draft[];
 sessionId:string;
 ledger:LedgerSnapshot;
 now:string;
 service:ImportStatementService;
}):Promise<ResolvedWebImport>{
 if(!input.drafts.length)throw Error('EMPTY_IMPORT');
 const records=input.drafts.map(draft=>legacyDraftToExternalRecord(draft,input.sessionId,input.now));
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
  const session=completeImportSession(resolved.result.session,execution,attention,now);
  current.sessions[session.id]=structuredClone(session);
  current.records[session.id]=structuredClone(resolved.records);
  current.attention[session.id]=structuredClone(attention);
  current.outcomes[session.id]=importRecordOutcomes(session.id,execution,now);
  store.state.importWorkspace=current;output={execution,session};
 });
 if(!output)throw Error('IMPORT_COMMIT_FAILED');
 return output;
}
