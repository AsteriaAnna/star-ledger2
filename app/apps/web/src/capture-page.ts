import {createWebCapture,runWebCapture,refreshWebCapture,abandonWebCapture,captureMessage} from './capture-client.ts';
import {cloudbaseSession,cloudbaseSignIn,rememberCloudIdentity,localCloudIdentity} from './cloudbase.ts';
import {mutate,read,selectLocalLedger,type State} from './store.ts';
import {captureMoneyFen,captureTime} from '../../../packages/importing/capture-response.ts';
import type {CaptureJob} from './capture-jobs.ts';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const labels={QUEUED:'等待上传',WAITING:'正在识别',NEEDS_INPUT:'需要补充',FAILED:'识别未完成',COMPLETED:'已处理',CANCELLED:'已放弃'};
export function captureJobPanels(state:State){return Object.values(state.captureJobs??{}).filter(j=>j.state!=='CANCELLED').sort((a,b)=>b.createdAt-a.createdAt).slice(0,20).map(j=>`<section class="panel capture-job" data-capture-job="${esc(j.id)}"><div class="panel-heading"><div><h2>${j.sourceSystem==='WECHAT'?'微信':'支付宝'}截图 · ${labels[j.state]}</h2><p class="dim">${new Date(j.createdAt).toLocaleString('zh-CN')}</p></div>${['QUEUED','WAITING'].includes(j.state)?'<span role="status" class="tag">处理中…</span>':''}</div>${j.summary?`<p>新增 ${j.summary.created} 笔 · 重复 ${j.summary.duplicate} 笔${j.summary.noEffect?' · 无需入账 '+j.summary.noEffect+' 条':''}</p>`:''}${j.error?`<p role="status">${esc(captureMessage(j.error))}</p>`:''}<div class="button-row">${(j.transactionIds??[]).map(id=>`<button class="primary" data-detail="${esc(id)}">查看 / 修改账单</button>`).join('')}${['QUEUED','FAILED'].includes(j.state)?`<button class="primary" data-capture-retry="${esc(j.id)}">${j.evidence?'继续处理':'重试'}</button>`:''}${j.state==='NEEDS_INPUT'&&j.sessionId?`<button class="primary" data-capture-supplement="${esc(j.id)}">补充缺失信息</button>`:''}${j.state!=='COMPLETED'||j.sessionId&&state.importWorkspace?.attention[j.sessionId]?.length?`<button class="secondary" data-capture-abandon="${esc(j.id)}">${j.state==='COMPLETED'?'放弃剩余待处理':'放弃本次输入'}</button>`:''}</div>${j.state==='WAITING'?'<p class="footnote">可以继续使用账本，完成后回到这里查看。上传途中关闭网页可能需要重试。</p>':''}</section>`).join('');}
type UI={modal:(title:string,html:string)=>void;close:()=>void;refresh:()=>Promise<void>;openImport:()=>void;error:(e:unknown)=>void;toast:(s:string)=>void};
let ui:UI;
export function installCapturePage(callbacks:UI){ui=callbacks;
 document.addEventListener('click',ev=>{const el=(ev.target as Element).closest<HTMLElement>('button');if(!el)return;
  const action=el.dataset.captureRetry?'retry':el.dataset.captureAbandon?'abandon':el.dataset.captureSupplement?'supplement':null;
  const id=el.dataset.captureRetry||el.dataset.captureAbandon||el.dataset.captureSupplement;if(!action||!id)return;
  void (async()=>{try{
   if(action==='supplement'){await supplement(id);return;}
   (el as HTMLButtonElement).disabled=true;
   if(action==='abandon'){if(!confirm('放弃本次未完成输入？已经保存的账单会保留。'))return;await abandonWebCapture(id);}
   else await runWebCapture(id);
   await ui.refresh();
  }catch(e){ui.error(e);}finally{(el as HTMLButtonElement).disabled=false;}})();
 });
 let polling=false;
 setInterval(()=>{if(polling||document.visibilityState!=='visible')return;polling=true;void (async()=>{try{const state=await read();let changed=false;
  for(const j of Object.values(state.captureJobs??{})){
   if(j.state==='CANCELLED')continue;
   if(j.image&&Date.now()>=j.expiresAt){await mutate(s=>{const current=s.state.captureJobs?.[j.id];if(current){delete current.image;if(current.state!=='COMPLETED'){current.state='FAILED';current.error='CAPTURE_EXPIRED';}}});changed=true;continue;}
   if(j.state!=='WAITING')continue;
   try{await refreshWebCapture(j.id);const latest=(await read()).captureJobs?.[j.id];if(latest?.state!==j.state)changed=true;}catch{/* Existing request may still be running; do not create another paid call. */}
  }if(changed)await ui.refresh();
 }catch{/* Storage may not be open yet; next visible poll resumes. */}finally{polling=false;}})();},3000);
}
export async function openCapturePage(){
 let session;try{session=await cloudbaseSession();}catch{session=null;}
 if(!session){ui.modal('登录后截图记账',`<form id="capture-login"><p>使用已有测试账号登录。</p><label>账号<input name="username" autocomplete="username" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label><div class="modal-actions"><button type="submit" class="primary">登录并继续</button></div><p id="capture-login-error" role="alert"></p></form>`);
  const form=document.querySelector<HTMLFormElement>('#capture-login')!;form.onsubmit=ev=>{ev.preventDefault();const b=form.querySelector<HTMLButtonElement>('button')!;b.disabled=true;void(async()=>{try{const values=new FormData(form);const identity=await cloudbaseSignIn(String(values.get('username')),String(values.get('password')));await selectLocalLedger(identity.uid);rememberCloudIdentity(identity);await ui.refresh();await openCapturePage();}catch{form.querySelector('#capture-login-error')!.textContent='登录未成功，请检查账号密码和网络。';}finally{b.disabled=false;}})();};return;
 }
 if(localCloudIdentity()?.uid!==session.uid){await selectLocalLedger(session.uid);rememberCloudIdentity(session);await ui.refresh();}
 const selected=(await read()).settings.capturePlatform||'WECHAT';
 ui.modal('截图记账',`<form id="capture-select"><p>选择支付详情截图，识别完成后自动记账；缺失信息可补充，分类可随时修改。</p><label>截图来源<select name="platform"><option value="WECHAT" ${selected==='WECHAT'?'selected':''}>微信</option><option value="ALIPAY" ${selected==='ALIPAY'?'selected':''}>支付宝</option></select></label><label>选择截图<input type="file" name="image" accept="image/png,image/jpeg,image/webp" required></label><p class="footnote">截图经腾讯云模型处理。处理结果可靠保存后清理临时副本，不删除手机原照片。单张支持PNG、JPEG、WebP，最大4 MB。</p><div class="modal-actions"><button type="submit" class="primary">开始识别</button></div><p id="capture-select-error" role="alert"></p></form>`);
 const form=document.querySelector<HTMLFormElement>('#capture-select')!;form.onsubmit=ev=>{ev.preventDefault();const b=form.querySelector<HTMLButtonElement>('button')!;b.disabled=true;void(async()=>{try{
  const values=new FormData(form),file=values.get('image') as File,sourceSystem=values.get('platform') as 'WECHAT'|'ALIPAY';
  const job=await createWebCapture(file,sourceSystem);await mutate(s=>{s.state.settings.capturePlatform=sourceSystem;});ui.close();await ui.refresh();ui.openImport();
  // Keep navigation available during the cloud invocation.
  void runWebCapture(job.id).then(()=>ui.refresh()).catch(ui.error);
 }catch(e){form.querySelector('#capture-select-error')!.textContent=e instanceof Error?captureMessage(e.message):'暂时无法开始识别';}finally{b.disabled=false;}})();};
}
async function supplement(id:string){const state=await read(),job=state.captureJobs?.[id];if(!job?.sessionId)return;
 const items=(state.importWorkspace?.attention[job.sessionId]??[]).filter(i=>i.blocking);
 const supported=items.every(i=>['AMOUNT','DATE','STATUS','EVENT_MEANING'].includes(i.kind));
 if(!supported){ui.modal('需要核对截图',`<p>这张截图涉及来源关联或资金分摊，需要进一步核对。当前不会自动记账。</p><p>可以先放弃本次输入，或在导入页处理已有的关联问题。</p>`);return;}
 ui.modal('补充缺失信息',`<form id="capture-supplement">${items.map((item,index)=>`<label>${esc(item.question)}${item.kind==='AMOUNT'?`<input name="value-${index}" inputmode="decimal" placeholder="金额 · 元" required>`:item.kind==='DATE'?`<input name="value-${index}" type="datetime-local" required>`:item.kind==='STATUS'?`<select name="value-${index}"><option value="SUCCESS">已成功</option><option value="PENDING">还未完成</option><option value="FAILED">已失败</option></select>`:`<select name="value-${index}"><option value="PURCHASE">付款消费</option><option value="INCOME">收入</option><option value="REFUND">退款</option></select>`}</label>`).join('')}<div class="modal-actions"><button class="primary" type="submit">保存并继续</button></div><p id="capture-answer-error" role="alert"></p></form>`);
 const form=document.querySelector<HTMLFormElement>('#capture-supplement')!;form.onsubmit=ev=>{ev.preventDefault();const b=form.querySelector<HTMLButtonElement>('button')!;b.disabled=true;void(async()=>{try{
  const values=new FormData(form),answers:CaptureJob['answers']={};items.forEach((item,index)=>{const value=String(values.get('value-'+index));const answer=answers[item.externalRecordId]??={};
   if(item.kind==='AMOUNT'){const amount=captureMoneyFen(value);if(!amount||/^-/.test(value))throw Error('请填写正确的正数金额');answer.amountFen=amount;}
   if(item.kind==='DATE'){const time=captureTime(value.replace('T',' '));if(!time.occurredAt)throw Error('请填写正确的日期时间');answer.occurredAt=time.occurredAt;}
   if(item.kind==='STATUS')answer.status=value as 'SUCCESS'|'PENDING'|'FAILED';
   if(item.kind==='EVENT_MEANING')answer.eventKind=value as 'PURCHASE'|'INCOME'|'REFUND';
  });await mutate(s=>{const current=s.state.captureJobs?.[id];if(!current||current.state==='CANCELLED')throw Error('CAPTURE_TASK_CANCELLED');current.answers={...current.answers,...answers};});
  await runWebCapture(id);ui.close();await ui.refresh();
 }catch(e){form.querySelector('#capture-answer-error')!.textContent=e instanceof Error?e.message:'保存失败，请重试';}finally{b.disabled=false;}})();};
}
