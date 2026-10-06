import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import {cloudbaseClient,cloudbaseSession} from './cloudbase.ts';
import {mutate,read,assertLocalLedgerOwner} from './store.ts';
import {importWebCapture} from './capture-import-flow.ts';
import type {CaptureJob} from './capture-jobs.ts';
import type {CaptureEvidence} from '../../../packages/importing/types.ts';
import type {CaptureTask} from '../../../packages/application/capture-task.ts';
export const captureMessages:Record<string,string>={CAPTURE_IMAGE_TOO_LARGE:'截图不能超过4 MB，请选择较小的截图',INVALID_CAPTURE_IMAGE_TYPE:'请选择PNG、JPEG或WebP截图',CLOUD_AUTH_REQUIRED:'请先登录你的测试账号',CAPTURE_ACCESS_DENIED:'此账号还未加入截图试用名单',CAPTURE_SERVICE_NOT_CONFIGURED:'识别服务尚未配置，请稍后再试',CAPTURE_SERVICE_UNAVAILABLE:'识别服务暂时无法连接，可以稍后重试',CAPTURE_MODEL_UNAVAILABLE:'识别服务暂时繁忙，可以重试',CAPTURE_MODEL_OUTPUT_INVALID:'识别结果不完整，没有新增账单',CAPTURE_PLATFORM_MISMATCH:'截图来源与所选平台不一致，请重新选择平台',INVALID_CAPTURE_RESPONSE_JSON:'识别结果格式有误，没有新增账单',CAPTURE_RETRY_LIMIT:'这次识别已重试，请手动记录或重新选择截图',CAPTURE_NOT_PAYMENT:'这不是可直接记账的支付详情截图',CAPTURE_EXPIRED:'任务已过期，请重新选择截图',STALE_CAPTURE_IMPORT_PLAN:'账本刚刚发生了变化，请点击继续处理'};
export const captureMessage=(code?:string)=>captureMessages[code??'']??'截图需要核对，尚未新增账单。可以补充缺失信息或放弃。';
function ledgerFor(uid:string){return 'cloud-'+bytesToHex(sha256(new TextEncoder().encode(uid))).slice(0,32);}
async function identity(uid?:string){const session=await cloudbaseSession();if(!session||uid&&uid!==session.uid)throw Error('CLOUD_AUTH_REQUIRED');assertLocalLedgerOwner(session.uid);return session;}
async function call(job:CaptureJob,action:string,extra:Record<string,unknown>={}){
 await identity(job.uid);const client=await cloudbaseClient();let response:any;
 try{response=await client.callFunction({name:'star-ledger-capture',data:{action,id:job.id,contentHash:job.contentHash,sourceSystem:job.sourceSystem,...extra}});}catch{throw Error('CAPTURE_SERVICE_UNAVAILABLE');}
 if(!response.result?.ok)throw Error(response.result?.error||'CAPTURE_SERVICE_UNAVAILABLE');
 return response.result.value as {task:CaptureTask;evidence:CaptureEvidence|null}|null;
}
export async function createWebCapture(file:File,sourceSystem:'WECHAT'|'ALIPAY'){
 const session=await identity();if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('INVALID_CAPTURE_IMAGE_TYPE');if(file.size>4*1024*1024)throw Error('CAPTURE_IMAGE_TOO_LARGE');
 const contentHash=bytesToHex(sha256(new Uint8Array(await file.arrayBuffer()))),state=await read();
 const old=Object.values(state.captureJobs??{}).find(j=>j.uid===session.uid&&j.contentHash===contentHash&&j.sourceSystem===sourceSystem&&j.state!=='CANCELLED'&&j.expiresAt>Date.now());if(old)return old;
 const now=Date.now(),job:CaptureJob={id:'capture:'+crypto.randomUUID(),uid:session.uid,ledgerId:ledgerFor(session.uid),contentHash,sourceSystem,mime:file.type,image:file,createdAt:now,expiresAt:now+86400000,state:'QUEUED'};
 await mutate(s=>{assertLocalLedgerOwner(session.uid);s.state.captureJobs??={};s.state.captureJobs[job.id]=job;});return job;
}
async function acceptResult(id:string,value:Awaited<ReturnType<typeof call>>){if(!value)return;
 await mutate(s=>{const job=s.state.captureJobs?.[id];if(!job||['CANCELLED','COMPLETED'].includes(job.state))return;assertLocalLedgerOwner(job.uid);
  if(value.task.id!==job.id||value.task.userId!==job.uid||value.task.ledgerId!==job.ledgerId||value.task.contentHash!==job.contentHash)throw Error('CAPTURE_RESULT_MISMATCH');
  job.remote=value.task;if(value.evidence){job.evidence=value.evidence;delete job.image;}
  if(value.task.state==='CANCELLED'||value.task.state==='EXPIRED'){job.state='CANCELLED';delete job.image;}
  else if(value.task.state==='RETRYABLE_FAILURE'||value.task.state==='RECONCILING'){job.state='FAILED';job.error='CAPTURE_SERVICE_UNAVAILABLE';}
  else if(['LOCAL_QUEUED','UPLOADING','ACCEPTED','ANALYZING'].includes(value.task.state)){job.state='WAITING';delete job.error;}
 });if(value.evidence)await importWebCapture(id);
}
const running=new Map<string,Promise<void>>();
export function runWebCapture(id:string):Promise<void>{if(running.has(id))return running.get(id)!;
 const run=(async()=>{const job=(await read()).captureJobs?.[id];if(!job||['CANCELLED','COMPLETED'].includes(job.state))return;
  try{
   if(job.evidence){await importWebCapture(id);return;}
   const prior=await call(job,'read');if(prior){await acceptResult(id,prior);if(prior.evidence||['CANCELLED','EXPIRED','ANALYZING'].includes(prior.task.state))return;}
   if(!job.image)throw Error('CAPTURE_EXPIRED');
   await call(job,'queue');await mutate(s=>{const current=s.state.captureJobs?.[id];if(current&&current.state!=='CANCELLED')current.state='WAITING';});window.dispatchEvent(new Event('capture-updated'));
   const current=(await read()).captureJobs?.[id];if(!current||current.state==='CANCELLED')return;
   const bytes=new Uint8Array(await job.image.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   await acceptResult(id,await call(job,'analyze',{image:btoa(binary),mime:job.mime}));
  }catch(error){const code=error instanceof Error?error.message:'CAPTURE_SERVICE_UNAVAILABLE';await mutate(s=>{const current=s.state.captureJobs?.[id];if(current&&!['CANCELLED','COMPLETED'].includes(current.state)){current.state='FAILED';current.error=code;}});}
 })().finally(()=>running.delete(id));running.set(id,run);return run;
}
export async function refreshWebCapture(id:string){const job=(await read()).captureJobs?.[id];if(!job||['CANCELLED','COMPLETED'].includes(job.state))return;await acceptResult(id,await call(job,'read'));}
export async function abandonWebCapture(id:string){const job=(await read()).captureJobs?.[id];if(!job)return;await identity(job.uid);
 await mutate(s=>{const current=s.state.captureJobs?.[id];if(!current)return;current.state='CANCELLED';delete current.image;
  const w=s.state.importWorkspace,sid=current.sessionId;if(w&&sid){delete w.sessions[sid];delete w.records[sid];delete w.attention[sid];delete w.outcomes[sid];delete w.interpretations?.[sid];delete w.captureEvidence?.[sid];}
 });try{await call(job,'cancel');}catch{/* Local cancellation fences late responses. */}
}
