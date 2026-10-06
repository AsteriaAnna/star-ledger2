/** R03/C01/C02/C06 K02: capture transport lifecycle; import outcomes remain authoritative. */
export type CaptureScope={userId:string;ledgerId:string};
export type CaptureState='LOCAL_QUEUED'|'UPLOADING'|'ACCEPTED'|'ANALYZING'|'RECONCILING'|'READY'|'NEEDS_INPUT'|'COMMITTING'|'COMPLETED'|'RETRYABLE_FAILURE'|'CANCELLED'|'EXPIRED';
export type CaptureResultRef={id:string;schemaVersion:string;promptVersion:string;responseHash:string};
export type CaptureReceipt={commitId:string;importSessionId:string;outcomeRecordIds:string[]};
export type CaptureTask=CaptureScope&{
 id:string;version:number;state:CaptureState;contentHash:string;requestVersion:string;
 createdAt:number;updatedAt:number;expiresAt:number;attempt:number;automaticRetries:number;
 imageRef:string|null;remoteTaskId:string|null;result:CaptureResultRef|null;receipt:CaptureReceipt|null;
 lease:{token:string;expiresAt:number}|null;resume:'LOCAL_QUEUED'|'ACCEPTED';cleanup:'NONE'|'PENDING'|'DONE';
};
export type CaptureAction=
 |{kind:'START_UPLOAD'}
 |{kind:'ACCEPT';imageRef:string;remoteTaskId:string}
 |{kind:'CLAIM';token:string;leaseUntil:number}
 |{kind:'RESULT';token:string;attempt:number;result:CaptureResultRef}
 |{kind:'FAIL';certainty:'SAFE_TO_RETRY'|'UNKNOWN';token?:string;attempt?:number}
 |{kind:'RECONCILE';resolution:'SAFE_TO_RETRY'|'RESULT';result?:CaptureResultRef}
 |{kind:'RETRY';automatic:boolean}
 |{kind:'NEEDS_INPUT'}|{kind:'RESUME'}
 |{kind:'BEGIN_COMMIT';token:string;leaseUntil:number}
 |{kind:'RECOVER_LEASE'}|{kind:'CANCEL'}|{kind:'EXPIRE'}|{kind:'CLEANED'};
export interface CaptureTaskRepository {
 create(task:CaptureTask):Promise<boolean>;
 get(scope:CaptureScope,id:string):Promise<CaptureTask|null>;
 list(scope:CaptureScope):Promise<CaptureTask[]>;
 /** Must be one durable compare-and-swap transaction. */
 replace(scope:CaptureScope,id:string,expectedVersion:number,next:CaptureTask):Promise<boolean>;
 /** Task, ledger batch and existing import outcomes must share this transaction. Sync callback only. */
 complete(scope:CaptureScope,id:string,expectedVersion:number,next:CaptureTask,writeLedgerAndOutcomes:()=>void):Promise<boolean>;
}
const terminal=new Set<CaptureState>(['COMPLETED','CANCELLED','EXPIRED']);
const text=(v:string)=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v;
export function newCaptureTask(scope:CaptureScope,id:string,contentHash:string,requestVersion:string,now:number,expiresAt:number):CaptureTask{
 if(![scope.userId,scope.ledgerId,id,contentHash,requestVersion].every(text)||!Number.isSafeInteger(now)||!Number.isSafeInteger(expiresAt)||expiresAt<=now)throw Error('INVALID_CAPTURE_TASK');
 return {...scope,id,contentHash,requestVersion,version:0,state:'LOCAL_QUEUED',createdAt:now,updatedAt:now,expiresAt,attempt:0,automaticRetries:0,imageRef:null,remoteTaskId:null,result:null,receipt:null,lease:null,resume:'LOCAL_QUEUED',cleanup:'NONE'};
}
function resultValid(result:CaptureResultRef){if(!result||![result.id,result.schemaVersion,result.promptVersion,result.responseHash].every(text))throw Error('INVALID_CAPTURE_RESULT');}
function timeCheck(task:CaptureTask,now:number){if(!Number.isSafeInteger(now)||now<task.updatedAt)throw Error('INVALID_CAPTURE_TIME');}
function leased(task:CaptureTask,token:string|undefined,attempt:number|undefined,now:number){if(!task.lease||task.lease.token!==token||task.attempt!==attempt||now>=task.lease.expiresAt)throw Error('STALE_CAPTURE_WORKER');}
function state(task:CaptureTask,allowed:CaptureState[]){if(!allowed.includes(task.state))throw Error('INVALID_CAPTURE_TRANSITION');}
function lease(token:string,until:number,now:number,task:CaptureTask){if(!text(token)||!Number.isSafeInteger(until)||until<=now||until>task.expiresAt)throw Error('INVALID_CAPTURE_LEASE');return {token,expiresAt:until};}
export function changeCaptureTask(task:CaptureTask,action:CaptureAction,now:number):CaptureTask{
 timeCheck(task,now);const next=structuredClone(task);next.version++;next.updatedAt=now;
 if(action.kind==='CLEANED'){
  if(task.cleanup!=='PENDING')throw Error('CAPTURE_CLEANUP_NOT_DUE');
  next.cleanup='DONE';next.imageRef=null;return next;
 }
 if(terminal.has(task.state))throw Error('CAPTURE_TASK_TERMINAL');
 if(action.kind==='EXPIRE'){
  if(now<task.expiresAt)throw Error('CAPTURE_NOT_EXPIRED');
  next.state='EXPIRED';next.lease=null;next.cleanup='PENDING';return next;
 }
 if(now>=task.expiresAt)throw Error('CAPTURE_EXPIRED');
 switch(action.kind){
  case 'CANCEL':next.state='CANCELLED';next.lease=null;next.cleanup='PENDING';break;
  case 'START_UPLOAD':state(task,['LOCAL_QUEUED']);next.state='UPLOADING';break;
  case 'ACCEPT':
   state(task,['UPLOADING','RECONCILING']);if(task.state==='RECONCILING'&&task.resume!=='LOCAL_QUEUED')throw Error('CAPTURE_ANALYSIS_UNRESOLVED');if(!text(action.imageRef)||!text(action.remoteTaskId))throw Error('INVALID_CAPTURE_ACCEPTANCE');
   next.state='ACCEPTED';next.imageRef=action.imageRef;next.remoteTaskId=action.remoteTaskId;next.resume='ACCEPTED';break;
  case 'CLAIM':state(task,['ACCEPTED']);next.state='ANALYZING';next.lease=lease(action.token,action.leaseUntil,now,task);next.attempt++;break;
  case 'RESULT':state(task,['ANALYZING']);leased(task,action.token,action.attempt,now);resultValid(action.result);next.result=structuredClone(action.result);next.state='READY';next.lease=null;break;
  case 'FAIL':
   state(task,['UPLOADING','ANALYZING']);if(task.state==='ANALYZING')leased(task,action.token,action.attempt,now);
   next.state=action.certainty==='UNKNOWN'?'RECONCILING':'RETRYABLE_FAILURE';next.lease=null;break;
  case 'RECONCILE':
   state(task,['RECONCILING']);
   if(action.resolution==='RESULT'){if(!action.result)throw Error('INVALID_CAPTURE_RESULT');resultValid(action.result);next.result=structuredClone(action.result);next.state='READY';}
   else next.state='RETRYABLE_FAILURE';break;
  case 'RETRY':
   state(task,['RETRYABLE_FAILURE']);if(action.automatic&&task.automaticRetries>=1)throw Error('CAPTURE_RETRY_LIMIT');
   next.automaticRetries+=action.automatic?1:0;next.state=task.resume;break;
  case 'NEEDS_INPUT':state(task,['READY']);next.state='NEEDS_INPUT';break;
  case 'RESUME':state(task,['NEEDS_INPUT']);next.state='READY';break;
  case 'BEGIN_COMMIT':state(task,['READY']);if(!task.result)throw Error('CAPTURE_RESULT_REQUIRED');next.state='COMMITTING';next.lease=lease(action.token,action.leaseUntil,now,task);break;
  case 'RECOVER_LEASE':
   state(task,['ANALYZING','COMMITTING']);if(!task.lease||now<task.lease.expiresAt)throw Error('CAPTURE_LEASE_ACTIVE');
   // Analysis may still be billable/running. Commit rollback is safe only under the atomic repository contract.
   next.state=task.state==='ANALYZING'?'RECONCILING':'READY';next.lease=null;break;
 }
 return next;
}
export class CaptureTaskService {
 private repository:CaptureTaskRepository;
 constructor(repository:CaptureTaskRepository){this.repository=repository;}
 async change(scope:CaptureScope,id:string,expectedVersion:number,action:CaptureAction,now:number){
  const task=await this.repository.get(scope,id);if(!task)throw Error('CAPTURE_TASK_NOT_FOUND');
  if(task.version!==expectedVersion)throw Error('CAPTURE_VERSION_CONFLICT');
  const next=changeCaptureTask(task,action,now);
  if(!await this.repository.replace(scope,id,expectedVersion,next))throw Error('CAPTURE_VERSION_CONFLICT');return next;
 }
 async complete(scope:CaptureScope,id:string,expectedVersion:number,token:string,receipt:CaptureReceipt,now:number,writeLedgerAndOutcomes:()=>void){
  const task=await this.repository.get(scope,id);if(!task)throw Error('CAPTURE_TASK_NOT_FOUND');
  if(task.version!==expectedVersion)throw Error('CAPTURE_VERSION_CONFLICT');timeCheck(task,now);state(task,['COMMITTING']);
  if(now>=task.expiresAt)throw Error('CAPTURE_EXPIRED');leased(task,token,task.attempt,now);
  if(!receipt||![receipt.commitId,receipt.importSessionId,...receipt.outcomeRecordIds].every(text)||!receipt.outcomeRecordIds.length||new Set(receipt.outcomeRecordIds).size!==receipt.outcomeRecordIds.length)throw Error('INVALID_CAPTURE_RECEIPT');
  const next:CaptureTask={...task,version:task.version+1,updatedAt:now,state:'COMPLETED',lease:null,cleanup:'PENDING',receipt:structuredClone(receipt)};
  if(!await this.repository.complete(scope,id,expectedVersion,next,writeLedgerAndOutcomes))throw Error('CAPTURE_VERSION_CONFLICT');return next;
 }
}
