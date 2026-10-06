import {extractCaptureImport,planCaptureImport,captureImportSessionId} from '../../../packages/application/capture-import.ts';
import {ImportStatementService} from '../../../packages/application/import-service.ts';
import {importRecordOutcomes,completeImportSessionFromOutcomes,mergeImportOutcomes} from '../../../packages/application/import-execution.ts';
import {InMemoryImportWorkspace} from '../../../packages/importing/workspace.ts';
import {readAccountMapping,readMerchantCategory} from '../../../packages/importing/resolution-memory.ts';
import {importIdentityHash} from '../../../packages/importing/source-event-identity.ts';
import {BusinessAccountingService} from '../../../packages/accounting/business.ts';
import {finalizeImportRefunds} from './import-refund-finalize.ts';
import {mutate,read,MemoryStore,type State} from './store.ts';
import {sourceCategory} from './categories.ts';
import type {CaptureJob} from './capture-jobs.ts';
/** Prepare using common Excel services, without preparatory durable writes. */
export async function prepareWebCapture(state:State,job:CaptureJob,ledger:{entities:MemoryStore['entities'];conflicts:MemoryStore['conflicts']},now:string){
 if(!job.remote||!job.evidence||job.state==='CANCELLED'||job.remote.userId!==job.uid||job.remote.ledgerId!==job.ledgerId)throw Error('CAPTURE_RESULT_MISMATCH');
 const scope={userId:job.uid,ledgerId:job.ledgerId},e=job.evidence;
 const extraction=extractCaptureImport({raw:e.rawExtraction,schemaVersion:e.schemaVersion,promptVersion:e.promptVersion,model:e.model,contentHash:job.contentHash,sourceSystem:job.sourceSystem,profile:e.profile,capturedAt:e.capturedAt,sessionId:captureImportSessionId(scope,job.id)});
 if(extraction.evidence.responseHash!==e.responseHash||extraction.evidence.id!==e.id)throw Error('CAPTURE_RESULT_MISMATCH');
 // User answers supplement missing interpretations; original evidence stays immutable.
 for(const i of extraction.interpretations){const a=job.answers?.[i.externalRecordId];if(!a)continue;
  if(i.amountFen===null&&a.amountFen!==undefined)i.amountFen=a.amountFen;
  if(i.occurredAt===null&&a.occurredAt!==undefined)i.occurredAt=a.occurredAt;
  if(i.status==='UNKNOWN'&&a.status!==undefined)i.status=a.status;
  if(i.eventKind==='UNKNOWN'&&a.eventKind!==undefined)i.eventKind=a.eventKind;
 }
 const seed=structuredClone(state.importWorkspace);
 if(seed&&job.answers){const sid=captureImportSessionId(scope,job.id);seed.attention[sid]=(seed.attention[sid]??[]).filter(item=>{const a=job.answers?.[item.externalRecordId];return !(a&&(item.kind==='AMOUNT'&&a.amountFen!==undefined||item.kind==='DATE'&&a.occurredAt!==undefined||item.kind==='STATUS'&&a.status!==undefined||item.kind==='EVENT_MEANING'&&a.eventKind!==undefined));});}
 const workspace=new InMemoryImportWorkspace(seed);
 const service=new ImportStatementService(workspace,{findAccountMapping:async k=>readAccountMapping(ledger.entities,k),findMerchantCategory:async k=>readMerchantCategory(ledger.entities,k),rememberAccountMapping:async()=>{},rememberMerchantCategory:async()=>{}});
 const available=state.settings.categories as string[],fallback=available.includes('其他')?'其他':available[0];
 const facts=extraction.records[0]?.facts,platform=job.sourceSystem==='WECHAT'?'微信':'支付宝';
 const mapped=facts?.sourceCategoryRaw?sourceCategory(platform,facts.sourceCategoryRaw,'',''):null;
 const rule=facts?sourceCategory(platform,'',facts.counterpartyRaw,facts.productRaw):null;
 const plan=await planCaptureImport({extraction,task:job.remote,scope,ledger,service,category:{availableCategoryIds:available,fallbackCategoryId:fallback,mappedSourceCategoryId:mapped,ruleCategoryId:rule},now});
 return {plan,workspace:workspace.snapshot(),ledgerToken:importIdentityHash(ledger)};
}
export function applyWebCapture(store:MemoryStore,id:string,prepared:Awaited<ReturnType<typeof prepareWebCapture>>,now:string){
 const job=store.state.captureJobs?.[id];if(!job||job.state==='CANCELLED'||job.state==='COMPLETED')return;
 if(importIdentityHash({entities:store.entities,conflicts:store.conflicts})!==prepared.ledgerToken)throw Error('STALE_CAPTURE_IMPORT_PLAN');
 const p=prepared.plan;if(p.kind!=='IMPORT_PLAN'){job.state='NEEDS_INPUT';job.error=p.kind==='NO_PAYMENT_EVIDENCE'?'CAPTURE_NOT_PAYMENT':p.issues.map(i=>i.code).join(',');delete job.image;return;}
 const workspace=prepared.workspace,sessionId=p.resolved.session.id;job.sessionId=sessionId;
 if(p.execution.blockedRecordIds.length){store.state.importWorkspace=workspace;job.state='NEEDS_INPUT';delete job.image;return;}
 new BusinessAccountingService(store,store.state.device).executeBatch(p.execution.commands);
 workspace.outcomes[sessionId]=mergeImportOutcomes(workspace.outcomes[sessionId]??[],importRecordOutcomes(sessionId,p.execution,now));
 workspace.sessions[sessionId]=completeImportSessionFromOutcomes(p.resolved.session,workspace.outcomes[sessionId],workspace.attention[sessionId]??[],now);
 store.state.importWorkspace=workspace;finalizeImportRefunds(store,now);
 job.state='COMPLETED';job.receipt={commitId:'capture-commit:'+importIdentityHash({sessionId,responseHash:job.evidence!.responseHash}),importSessionId:sessionId,outcomeRecordIds:workspace.outcomes[sessionId].map(o=>o.externalRecordId)};job.summary={created:p.execution.createdIds.length,duplicate:workspace.sessions[sessionId].skippedDuplicateCount,noEffect:workspace.sessions[sessionId].noEffectCount};job.transactionIds=[...new Set(workspace.outcomes[sessionId].map(o=>o.transactionId).filter((v):v is string=>!!v&&store.entities.some(t=>t.type==='transactions'&&t.id===v&&!t.fields.deleted_at&&!t.fields.purged_at)))];delete job.error;delete job.image;
}
export async function importWebCapture(id:string){
 const state=await read(),job=state.captureJobs?.[id];if(!job||job.state==='COMPLETED'||job.state==='CANCELLED')return;
 const store=new MemoryStore(state),now=new Date().toISOString();
 const prepared=await prepareWebCapture(state,job,{entities:store.entities,conflicts:store.conflicts},now);
 await mutate(current=>{if(current.state.revision!==state.revision)throw Error('STALE_CAPTURE_IMPORT_PLAN');applyWebCapture(current,id,prepared,now);});
}
