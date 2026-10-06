/** K05a server workflow. uid must come from verified runtime identity, never event.body. */
import {newCaptureTask,changeCaptureTask,type CaptureTask,type CaptureScope} from './capture-task.ts';
import {validateCaptureEvidence} from '../importing/capture-evidence.ts';
import type {CaptureEvidence} from '../importing/types.ts';
export interface RemoteCaptureRepository {
 create(task:CaptureTask):Promise<boolean>;
 get(scope:CaptureScope,id:string):Promise<CaptureTask|null>;
 replace(scope:CaptureScope,id:string,version:number,next:CaptureTask):Promise<boolean>;
 publish(scope:CaptureScope,id:string,version:number,next:CaptureTask,evidence:CaptureEvidence):Promise<boolean>;
 result(scope:CaptureScope,id:string,resultId:string):Promise<CaptureEvidence|null>;
}
const authenticated=(uid:string)=>{if(typeof uid!=='string'||!uid.trim()||uid.length>256)throw Error('CLOUD_AUTH_REQUIRED');return uid;};
export class RemoteCaptureService {
 private repo:RemoteCaptureRepository;
 constructor(repo:RemoteCaptureRepository){this.repo=repo;}
 async queue(uid:string,ledgerId:string,id:string,contentHash:string,now:number){
  const scope={userId:authenticated(uid),ledgerId},task=newCaptureTask(scope,id,contentHash,'capture-request-1',now,now+24*3600000);
  if(await this.repo.create(task))return task;
  const old=await this.repo.get(scope,id);if(!old||old.contentHash!==contentHash||old.requestVersion!==task.requestVersion)throw Error('CAPTURE_TASK_ID_COLLISION');return old;
 }
 async read(uid:string,ledgerId:string,id:string){
  const scope={userId:authenticated(uid),ledgerId},task=await this.repo.get(scope,id);if(!task)return null;
  const evidence=task.result?await this.repo.result(scope,id,task.result.id):null;
  if(task.result){if(!evidence)throw Error('CAPTURE_DURABLE_RESULT_MISSING');validateCaptureEvidence(evidence);if(evidence.id!==task.result.id||evidence.responseHash!==task.result.responseHash||evidence.contentHash!==task.contentHash||evidence.schemaVersion!==task.result.schemaVersion||evidence.promptVersion!==task.result.promptVersion)throw Error('CAPTURE_RESULT_MISMATCH');}
  return {task,evidence};
 }
 async cancel(uid:string,ledgerId:string,id:string,version:number,now:number){
  const scope={userId:authenticated(uid),ledgerId},task=await this.repo.get(scope,id);if(!task)throw Error('CAPTURE_TASK_NOT_FOUND');if(task.version!==version)throw Error('CAPTURE_VERSION_CONFLICT');
  const next=changeCaptureTask(task,{kind:'CANCEL'},now);if(!await this.repo.replace(scope,id,version,next))throw Error('CAPTURE_VERSION_CONFLICT');return next;
 }
 /** Internal worker only. Lease/attempt/expiry checks precede the single atomic PG publish. */
 async publish(scope:CaptureScope,id:string,version:number,token:string,attempt:number,evidence:CaptureEvidence,now:number){
  validateCaptureEvidence(evidence);const task=await this.repo.get(scope,id);if(!task)throw Error('CAPTURE_TASK_NOT_FOUND');if(task.version!==version)throw Error('CAPTURE_VERSION_CONFLICT');
  if(task.contentHash!==evidence.contentHash)throw Error('CAPTURE_RESULT_MISMATCH');
  const next=changeCaptureTask(task,{kind:'RESULT',token,attempt,result:{id:evidence.id,schemaVersion:evidence.schemaVersion,promptVersion:evidence.promptVersion,responseHash:evidence.responseHash}},now);
  if(!await this.repo.publish(scope,id,version,next,evidence))throw Error('CAPTURE_VERSION_CONFLICT');return next;
 }
}
