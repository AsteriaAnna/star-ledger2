#!/usr/bin/env node
/** M5.1-O/F: private experiment. Never import this into the browser bundle. */
import {createHash} from 'node:crypto';
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {basename,extname,join,resolve} from 'node:path';
import {performance} from 'node:perf_hooks';

const endpoint='https://tokenhub.tencentmaas.com/v1/chat/completions';
const allowedModels=new Set(['hy-vision-2.0-instruct','hunyuan-t1-vision-20250916','youtu-vita']);
const mime={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
const systemPrompt=`你是金融截图事实提取助手。只输出 JSON 对象，不要 Markdown。分开 evidence 与 candidates。
evidence 包含 platform、displayAmount、status、merchant、paymentMethod、fields（每项 label,value,visible）、identifiers（每项 role,value,visible）、times（每项 role,value,precision）、moneyLines（每项 role,amount,time,status）、uncertain（字符串数组）。逐字保留长编号和前导零；跨行数字只有确实连续才接合。没看到的字段用 null，不猜测。
candidates 是数组，每项只表示一项实际资金事件，包含 kind（PAYMENT、REFUND、RETURN、TRANSFER、FEE、INCOME 或 UNKNOWN）、amount、time、relatedTo、evidenceLabels、uncertain。退款合计不能另生一笔；提示、分类、记账标记不是资金事件。不要自行判定星账的消费口径、账户余额或去重结果。`;
const userPrompt='请按约定 JSON 结构读取这张账单图片，完整识别所有金额、退款、时间和来源编号，然后列出资金事件候选。';

function parseArgs(argv){
 const out={mode:'vision',models:['hy-vision-2.0-instruct'],limit:4,dryRun:false};
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];if(arg==='--dry-run'){out.dryRun=true;continue;}
  const key=arg.slice(2);if(!arg.startsWith('--')||!['mode','input','ocr-json','out','models','limit','select'].includes(key)||!argv[i+1])throw Error(`无效参数：${arg}`);
  out[key]=argv[++i];
 }
 if(!['vision','ocr-text','local'].includes(out.mode))throw Error('mode 必须是 vision、ocr-text 或 local');
 out.limit=Number(out.limit);if(!Number.isInteger(out.limit)||out.limit<1||out.limit>15)throw Error('limit 必须为 1–15');
 out.models=String(out.models).split(',');if(out.models.some(m=>!allowedModels.has(m)))throw Error('模型不在本次腾讯云对照白名单');
 if(!out.input||!out.out)throw Error('需要 --input 图片目录和 --out 私密结果目录');
 if(out.mode!=='vision'&&!out['ocr-json'])throw Error('local 与 ocr-text 需要 --ocr-json');
 return out;
}

async function writePrivate(file,value){await writeFile(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});}
function caseId(file){return createHash('sha256').update(basename(file)).digest('hex').slice(0,12);}
function summarizeDraft(d){return {platform:d.platform,name:d.name,amount:d.amount,date:d.date,precision:d.precision,kind:d.kind,status:d.status,channel:d.channel,order:d.order,sponsor:d.sponsor,blockers:d.blockers};}
function bodyFor(mode,model,bytes,ocrText,extension){
 const content=mode==='vision'?[{type:'text',text:userPrompt},{type:'image_url',image_url:{url:`data:${mime[extension]};base64,${bytes.toString('base64')}`}}]:[{type:'text',text:`以下是 OCR 原文。请只以这段文字为可见证据，按约定 JSON 结构输出；无法确认的字段留空。\n${ocrText}`}];
 return {model,messages:[{role:'system',content:systemPrompt},{role:'user',content}],temperature:0,max_tokens:1800,stream:false};
}

async function callTokenHub(body,key){
 const started=performance.now();let response;
 try{response=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});}
 catch(error){return {ok:false,error:error.name==='TimeoutError'?'TIMEOUT':'NETWORK_ERROR',latencyMs:Math.round(performance.now()-started)};}
 const latencyMs=Math.round(performance.now()-started);let data;
 try{data=await response.json();}catch{return {ok:false,error:'NON_JSON_RESPONSE',httpStatus:response.status,latencyMs};}
 if(!response.ok)return {ok:false,error:String(data?.error?.code||'HTTP_ERROR').slice(0,80),httpStatus:response.status,latencyMs};
 const raw=String(data?.choices?.[0]?.message?.content||'');let parsed=null;
 try{parsed=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{}
 return {ok:true,model:data.model||body.model,latencyMs,usage:data.usage||null,finishReason:data?.choices?.[0]?.finish_reason||null,raw,parsed};
}

async function main(){
 process.umask(0o077);
 const options=parseArgs(process.argv.slice(2));const input=resolve(options.input),out=resolve(options.out);
 const selected=options.select?new Set(String(options.select).split(',')):null;
 const files=(await readdir(input)).filter(name=>mime[extname(name).toLowerCase()]&&(!selected||selected.has(name)||selected.has(caseId(name)))).sort().slice(0,options.limit);
 if(!files.length)throw Error('输入目录没有支持的图片');
 if(selected&&files.length!==selected.size)throw Error('select 中有文件未找到，或 limit 小于所选数量');
 let ocr=new Map();if(options['ocr-json']){
  const rows=JSON.parse(await readFile(resolve(options['ocr-json']),'utf8'));
  if(!Array.isArray(rows))throw Error('OCR JSON 应为包含 file、text 的数组');
  ocr=new Map(rows.map(row=>[basename(row.file),row.text]));
 }
 const planned=files.map(name=>({case:caseId(name),hasOcr:ocr.has(name)}));
 if(options.dryRun){console.log(JSON.stringify({dryRun:true,mode:options.mode,models:options.mode==='local'?[]:options.models,planned},null,2));return;}
 const key=process.env.TOKENHUB_API_KEY;
 if(options.mode!=='local'&&!key)throw Error('缺少 TOKENHUB_API_KEY；不要将密钥传进命令参数、截图或 GitHub');
 await mkdir(out,{recursive:true,mode:0o700});
 const parser=options.mode==='local'?(await import('../apps/web/src/importer.ts')).parseScreenshot:null;
 for(const name of files){
  const id=caseId(name),text=ocr.get(name);
  if(options.mode!=='vision'&&!text){console.log(`${id}: OCR_TEXT_MISSING`);continue;}
  if(options.mode==='local'){
   const draft=parser(text,id);
   await writePrivate(join(out,`${id}-local.json`),{case:id,mode:'local',draft:summarizeDraft(draft)});
   console.log(`${id}: local done`);continue;
  }
  const bytes=options.mode==='vision'?await readFile(join(input,name)):null;
  for(const model of options.models){
   const body=bodyFor(options.mode,model,bytes,text,extname(name).toLowerCase());
   const result=await callTokenHub(body,key);
   await writePrivate(join(out,`${id}-${options.mode}-${model}.json`),{case:id,mode:options.mode,result});
   console.log(`${id}: ${model} ${result.ok?'done':result.error} ${result.latencyMs}ms`);
  }
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
