'use strict';
const {createHash,randomUUID}=require('node:crypto');
const model='hy-vision-2.0-instruct';
const systemPrompt=`你是金融截图事实提取助手。只输出 JSON 对象，不要 Markdown。分开 evidence 与 candidates。
evidence 包含 platform、displayAmount、status、merchant、paymentMethod、fields（每项 label,value,visible）、identifiers（每项 role,value,visible）、times（每项 role,value,precision）、moneyLines（每项 role,amount,time,status）、uncertain（字符串数组）。逐字保留长编号和前导零；跨行数字只有确实连续才接合。没看到的字段用 null，不猜测。
candidates 是数组，每项只表示一项实际资金事件，包含 kind（PAYMENT、REFUND、RETURN、TRANSFER、FEE、INCOME 或 UNKNOWN）、amount、time、relatedTo、evidenceLabels、uncertain。退款合计不能另生一笔；提示、分类、记账标记不是资金事件。不要自行判定星账的消费口径、账户余额或去重结果。`;
const userPrompt='请按约定 JSON 结构读取这张账单图片，完整识别所有金额、退款、时间和来源编号，然后列出资金事件候选。';
const ledgerFor=uid=>'cloud-'+createHash('sha256').update(uid).digest('hex').slice(0,32);
function imageBytes(image,mime,hash){
 if(!['image/png','image/jpeg','image/webp'].includes(mime)||typeof image!=='string'||image.length>5592408||!image.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(image))throw Error('INVALID_CAPTURE_IMAGE');
 const bytes=Buffer.from(image,'base64');if(bytes.length>4*1024*1024||bytes.toString('base64')!==image)throw Error('INVALID_CAPTURE_IMAGE');
 const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!valid||createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('CAPTURE_IMAGE_HASH_MISMATCH');return bytes;
}
/** SDK identity and SQL transport are server-owned injected dependencies, never client fields. */
function createHandler({repo,shared,getUid,key,allowedUids,fetchImpl=fetch,now=Date.now,log=()=>{}}){
 const service=new shared.RemoteCaptureService(repo);
 async function step(t,action){const next=shared.changeCaptureTask(t,action,now());if(!await repo.replace(t,t.id,t.version,next))throw Error('CAPTURE_VERSION_CONFLICT');return next;}
 async function read(uid,id){let value=await service.read(uid,ledgerFor(uid),id);if(!value)return null;let t=value.task;
  if(!['READY','CANCELLED','EXPIRED'].includes(t.state)&&now()>=t.expiresAt)t=await step(t,{kind:'EXPIRE'});
  else if(t.state==='ANALYZING'&&t.lease&&now()>=t.lease.expiresAt){t=await step(t,{kind:'RECOVER_LEASE'});t=await step(t,{kind:'RECONCILE',resolution:'SAFE_TO_RETRY'});}
  else if(t.state==='RECONCILING')t=await step(t,{kind:'RECONCILE',resolution:'SAFE_TO_RETRY'});
  return {...value,task:t};
 }
 return async event=>{try{
  const uid=await getUid();if(typeof uid!=='string'||!uid)throw Error('CLOUD_AUTH_REQUIRED');
  // Pilot service is fail-closed until existing invited test UIDs are configured.
  if(!allowedUids.has(uid))throw Error('CAPTURE_ACCESS_DENIED');
  if(!event||typeof event.id!=='string'||!/^[a-zA-Z0-9:-]{1,100}$/.test(event.id))throw Error('INVALID_CAPTURE_REQUEST');
  if(event.action==='read')return {ok:true,value:await read(uid,event.id)};
  if(event.action==='cancel'){let v=await read(uid,event.id);if(!v)throw Error('CAPTURE_TASK_NOT_FOUND');if(!['CANCELLED','EXPIRED'].includes(v.task.state))v.task=await service.cancel(uid,ledgerFor(uid),event.id,v.task.version,now());return {ok:true,value:v};}
  if(!['queue','analyze'].includes(event.action)||!['WECHAT','ALIPAY'].includes(event.sourceSystem)||!/^([a-f0-9]{64})$/.test(event.contentHash))throw Error('INVALID_CAPTURE_REQUEST');
  if(!key)throw Error('CAPTURE_SERVICE_NOT_CONFIGURED');
  let task=await service.queue(uid,ledgerFor(uid),event.id,event.contentHash,now());
  if(event.action==='queue')return {ok:true,value:await read(uid,event.id)};
  if(['READY','CANCELLED','EXPIRED','ANALYZING'].includes(task.state))return {ok:true,value:await read(uid,event.id)};
  // A complete HTTPS request supplies the private image; no public URL or cloud object is created.
  let bytes=imageBytes(event.image,event.mime,event.contentHash);
  if(task.state==='RETRYABLE_FAILURE'){if(task.attempt>=2)throw Error('CAPTURE_RETRY_LIMIT');task=await step(task,{kind:'RETRY',automatic:false});}
  if(task.state==='LOCAL_QUEUED'){task=await step(task,{kind:'START_UPLOAD'});task=await step(task,{kind:'ACCEPT',imageRef:'invocation:'+task.id,remoteTaskId:task.id});}
  if(task.state!=='ACCEPTED')throw Error('CAPTURE_REQUEST_UNRESOLVED');
  task=await step(task,{kind:'CLAIM',token:randomUUID(),leaseUntil:Math.min(now()+120000,task.expiresAt)});
  const started=now();let received=false;
  try{
   const response=await fetchImpl('https://tokenhub.tencentmaas.com/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},signal:AbortSignal.timeout(35000),body:JSON.stringify({model,messages:[{role:'system',content:systemPrompt},{role:'user',content:[{type:'text',text:userPrompt},{type:'image_url',image_url:{url:'data:'+event.mime+';base64,'+bytes.toString('base64')}}]}],temperature:0,max_tokens:1800,stream:false})});
   received=true;bytes=null;event.image=null;
   if(!response.ok)throw Error('CAPTURE_MODEL_UNAVAILABLE');
   const body=await response.json();const raw=body?.choices?.[0]?.message?.content;
   if(typeof raw!=='string'||body.choices[0].finish_reason!=='stop')throw Error('CAPTURE_MODEL_OUTPUT_INVALID');
   log({taskId:task.id,model,latencyMs:now()-started,usage:body.usage??null});
   const parsed=shared.parseCaptureResponse(raw,'experiment-1');
   const expected=event.sourceSystem==='WECHAT'?/微信|WeChat/i:/支付宝|Alipay/i;
   if(!expected.test(parsed.platform??''))throw Error('CAPTURE_PLATFORM_MISMATCH');
   const extraction=shared.extractCaptureImport({raw,schemaVersion:'experiment-1',promptVersion:'experiment-1',model,contentHash:task.contentHash,sourceSystem:event.sourceSystem,profile:'本人',capturedAt:new Date(now()).toISOString(),sessionId:shared.captureImportSessionId(task,task.id)});
   await service.publish(task,task.id,task.version,task.lease.token,task.attempt,extraction.evidence,now());
  }catch(error){
   const current=await repo.get(task,task.id);
   if(current?.state==='ANALYZING'&&current.version===task.version)await step(current,{kind:'FAIL',certainty:received?'SAFE_TO_RETRY':'UNKNOWN',token:task.lease.token,attempt:task.attempt});
   throw error;
  }finally{bytes=null;event.image=null;}
  return {ok:true,value:await read(uid,event.id)};
 }catch(error){const code=error instanceof Error&&/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'CAPTURE_SERVICE_UNAVAILABLE';return {ok:false,error:code};}};
}
module.exports={createHandler,imageBytes,ledgerFor};
