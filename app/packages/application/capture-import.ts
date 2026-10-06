/** K04: validated extraction -> existing import services. No network or direct accounting writes. */
import type {LedgerSnapshot} from '../accounting/index.ts';
import type {CaptureTask,CaptureScope} from './capture-task.ts';
import {captureEvidence,captureEventRecords} from '../importing/capture-evidence.ts';
import {parseCaptureResponse} from '../importing/capture-response.ts';
import {interpretCaptureFacts,captureInterpretations} from '../importing/capture-interpretation.ts';
import {decideImportCategory,type CategoryDecisionInput} from '../importing/category-decision.ts';
import {findSourceMatch} from '../importing/dedup.ts';
import {importIdentityHash} from '../importing/source-event-identity.ts';
import {ImportStatementService} from './import-service.ts';
import {planImportCommit} from './import-commit.ts';
import {planImportExecution,importRecordOutcomes} from './import-execution.ts';
import type {CaptureTaskService} from './capture-task.ts';
export type CaptureImportInput={raw:string;schemaVersion:string;promptVersion:string;model:string;contentHash:string;sourceSystem:'WECHAT'|'ALIPAY';profile:string;capturedAt:string;sessionId:string};
export function extractCaptureImport(input:CaptureImportInput){
 const response=parseCaptureResponse(input.raw,input.schemaVersion),interpreted=interpretCaptureFacts(response,input.sourceSystem);
 const evidence=captureEvidence({contentHash:input.contentHash,schemaVersion:input.schemaVersion,promptVersion:input.promptVersion,model:input.model,pageKind:interpreted.pageKind,sourceSystem:input.sourceSystem,platformRaw:input.sourceSystem==='WECHAT'?'微信':'支付宝',profile:input.profile,rawExtraction:input.raw,capturedAt:input.capturedAt});
 const records=interpreted.pageKind==='payment_detail'?captureEventRecords(evidence,input.sessionId,interpreted.observations,4):[];
 return {evidence,records,interpretations:captureInterpretations(records,interpreted.kinds),issues:interpreted.issues};
}
export function captureImportSessionId(scope:CaptureScope,taskId:string){return 'capture-session:'+importIdentityHash({userId:scope.userId,ledgerId:scope.ledgerId,taskId});}
/** Category context must be read at planning time, not saved with a model request. */
export async function planCaptureImport(input:{extraction:ReturnType<typeof extractCaptureImport>;task:CaptureTask;scope:CaptureScope;ledger:LedgerSnapshot;service:ImportStatementService;category:Omit<CategoryDecisionInput,'userCategoryId'>;now:string}){
 const {task,scope,extraction,ledger,service}=input,e=extraction.evidence;
 if(task.userId!==scope.userId||task.ledgerId!==scope.ledgerId)throw Error('CAPTURE_SCOPE_MISMATCH');
 if(!['READY','COMMITTING'].includes(task.state)||!Number.isFinite(Date.parse(input.now))||Date.parse(input.now)>=task.expiresAt)throw Error('CAPTURE_IMPORT_TASK_NOT_READY');
 if(task.contentHash!==e.contentHash||!task.result||task.result.id!==e.id||task.result.responseHash!==e.responseHash||task.result.schemaVersion!==e.schemaVersion||task.result.promptVersion!==e.promptVersion)throw Error('CAPTURE_IMPORT_RESULT_MISMATCH');
 const sessionId=captureImportSessionId(scope,task.id);
 if(extraction.records.some(r=>r.sessionId!==sessionId))throw Error('CAPTURE_IMPORT_SESSION_MISMATCH');
 if(e.pageKind!=='payment_detail')return {kind:'NO_PAYMENT_EVIDENCE' as const,extraction};
 const critical=extraction.issues.filter(i=>i.code!=='SUMMARY_NOT_EVENT');
 if(critical.length)return {kind:'EXTRACTION_REVIEW' as const,extraction,issues:critical};
 const decisions=extraction.records.map((record,i)=>{
  const match=findSourceMatch({value:record.sourceIdentity,platform:record.platformRaw,profile:record.profile,orderId:record.facts.orderId,rawPayload:record.rawPayload,captureEventClass:record.capture?.sourceClass},ledger.entities);
  const target=match.transactionIds.length===1?ledger.entities.find(t=>t.type==='transactions'&&t.id===match.transactionIds[0]):null;
  let edited:string[]=[];
  if(target?.fields.user_edits){try{const history=JSON.parse(String(target.fields.user_edits));if(history.version!==1||!Array.isArray(history.fields)||history.fields.some((v:unknown)=>typeof v!=='string'))throw Error();edited=history.fields;}catch{throw Error('INVALID_USER_EDIT_HISTORY');}}
  const effects=target?ledger.entities.filter(t=>t.type==='consumption_effects'&&t.fields.transaction_id===target.id):[];
  if(edited.includes('category')&&effects.length!==1)throw Error('CAPTURE_USER_CATEGORY_UNAVAILABLE');
  const category=decideImportCategory({...input.category,userCategoryId:edited.includes('category')?String(effects[0].fields.category_id):null});
  return {interpretation:{...extraction.interpretations[i],categorySuggestion:category.categoryId,evidence:[...extraction.interpretations[i].evidence,{kind:category.authority==='AI'?'AI_SUGGESTION' as const:'DETERMINISTIC_RULE' as const,code:'CATEGORY_'+category.authority,sourceFields:[]}]},category};
 });
 const prepared=await service.prepare({sessionId,sourceType:'SCREENSHOT',sourceSystem:e.sourceSystem,records:extraction.records,interpretations:decisions.map(d=>d.interpretation),captureEvidence:[e],ledger,now:input.now});
 const resolved=await service.resolve({prepared,records:extraction.records,ledger,now:input.now});
 const execution=planImportExecution(planImportCommit(resolved,extraction.records),ledger,input.now);
 return {kind:'IMPORT_PLAN' as const,ledgerToken:importIdentityHash(ledger),extraction,resolved,execution,categories:decisions.map(d=>d.category)};
}

export type CaptureImportPlan=Extract<Awaited<ReturnType<typeof planCaptureImport>>,{kind:'IMPORT_PLAN'}>;
/** Repository.complete owns the transaction. Both callbacks must use the same durable database. */
export async function completeCaptureImport(input:{plan:CaptureImportPlan;task:CaptureTask;tasks:CaptureTaskService;token:string;now:number;readLedger:()=>LedgerSnapshot;writeLedgerAndOutcomes:(plan:CaptureImportPlan,outcomes:ReturnType<typeof importRecordOutcomes>)=>void}){
 if(input.writeLedgerAndOutcomes.constructor.name==='AsyncFunction')throw Error('CAPTURE_ASYNC_COMMIT_FORBIDDEN');
 const {plan,task}=input;
 if(plan.execution.blockedRecordIds.length)throw Error('CAPTURE_IMPORT_NEEDS_INPUT');
 const e=plan.extraction.evidence;
 if(task.result?.id!==e.id||task.result.responseHash!==e.responseHash||task.contentHash!==e.contentHash||plan.resolved.session.id!==captureImportSessionId(task,task.id))throw Error('CAPTURE_IMPORT_RESULT_MISMATCH');
 const outcomes=importRecordOutcomes(plan.resolved.session.id,plan.execution,new Date(input.now).toISOString());
 if(outcomes.length!==plan.extraction.records.length||new Set(outcomes.map(o=>o.externalRecordId)).size!==outcomes.length)throw Error('CAPTURE_IMPORT_OUTCOME_MISMATCH');
 const receipt={commitId:'capture-commit:'+importIdentityHash({sessionId:plan.resolved.session.id,responseHash:e.responseHash}),importSessionId:plan.resolved.session.id,outcomeRecordIds:outcomes.map(o=>o.externalRecordId)};
 return input.tasks.complete(task,task.id,task.version,input.token,receipt,input.now,()=>{
  if(importIdentityHash(input.readLedger())!==plan.ledgerToken)throw Error('STALE_CAPTURE_IMPORT_PLAN');
  const returned:unknown=input.writeLedgerAndOutcomes(plan,outcomes);
  if(returned&&typeof (returned as {then?:unknown}).then==='function')throw Error('CAPTURE_ASYNC_COMMIT_FORBIDDEN');
 });
}
