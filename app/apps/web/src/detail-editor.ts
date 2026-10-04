import {installFinancialFields,detailLabels,toEditInput,fromEditInput} from './detail-financial-fields.ts';
import {transactionEditContext,detailFieldNames,type DetailFields} from '../../../packages/application/transaction-edit.ts';
import type {LedgerSnapshot} from '../../../packages/accounting/index.ts';
import {project} from '../../../packages/sync/projection.ts';
import {read} from './store.ts';
import {saveDetailEdit} from './detail-edit.ts';
import {changedDetailFields,draftKey,listDetailDrafts,readDetailDraft,writeDetailDraft,type DetailDraft} from './detail-drafts.ts';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
// Unique per document, so independent windows never overwrite one another's drafts.
const tab=crypto.randomUUID();
let active:{persist:()=>void;saving:()=>boolean}|null=null;
window.addEventListener('beforeunload',ev=>{if(!active)return;let failed=false;try{active.persist();}catch{failed=true;}if(failed||active.saving()){ev.preventDefault();ev.returnValue='';}});
export function leaveDetailEditor(){if(active?.saving())throw Error('EDIT_SAVE_IN_PROGRESS');active?.persist();active=null;}
export function unavailableDetailDraft(device:string,key:string){const draft=readDetailDraft(localStorage,key,device);return draft?`<p>原账单已删除或不可用，草稿仍保留。可以复制下面的内容。</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(draft.values.name)}\n${esc(draft.values.note)}\n${esc(draft.values.category)}</pre><button data-discard-edit-draft="${esc(key)}">放弃这份草稿</button>`:'<p>没有找到这份草稿。</p>'; }
export function discardDetailDraft(device:string,key:string){if(readDetailDraft(localStorage,key,device))localStorage.removeItem(key);}
export function detailDraftBanner(device:string){
 try{const drafts=listDetailDrafts(localStorage,device);if(!drafts.length)return '';
  return `<div class="banner detail-draft-banner">有 ${drafts.length} 份未保存的账单修改，仅暂存在本机。${drafts.map(({key,draft})=>`<button data-edit-draft="${esc(key)}" data-transaction="${esc(draft.transactionId)}">继续编辑 ${esc(draft.values.name||'账单')}</button>`).join('')}</div>`;
 }catch{return '<div class="banner warning">暂时无法读取本机编辑草稿。</div>';}
}
export function installDetailEditor(input:{form:HTMLFormElement;device:string;id:string;snapshot:LedgerSnapshot;draftId?:string;done:()=>Promise<void>;error:(e:unknown)=>void}){
 const {form,device,id}=input;const current=transactionEditContext(input.snapshot,id);
 // Prefer this tab's draft; explicit recovery copies a different document's draft.
 const key=draftKey(device,tab,id),own=readDetailDraft(localStorage,key,device);
 const recovered=input.draftId?readDetailDraft(localStorage,input.draftId,device):null;
 const original=recovered?.transactionId===id?recovered:own;
 let draft:DetailDraft=original?structuredClone(original):{version:1,device,transactionId:id,expectedSnapshot:current.expectedSnapshot,base:current.fields,values:current.fields,updatedAt:new Date().toISOString()};
 // Older metadata-only drafts inherit new fields without marking them as user edits.
 draft={...draft,base:{...current.fields,...draft.base},values:{...current.fields,...draft.values}};
 const financial=installFinancialFields(form,input.snapshot,current.fields);
 let sourceKey=original===recovered?input.draftId:undefined,sourceRaw=sourceKey?localStorage.getItem(sourceKey):null;
 let saving=false;
 const status=document.createElement('p');status.className='footnote';status.id='detail-draft-status';status.setAttribute('role','status');form.prepend(status);
 const controls=document.createElement('div');controls.className='button-row';controls.innerHTML='<button type="button" data-detail-latest>查看最新账单并对比</button><button type="button" data-detail-discard>放弃这些修改</button>';status.after(controls);
 const comparison=document.createElement('div');comparison.id='detail-edit-comparison';controls.after(comparison);
 const setValues=(values:DetailFields)=>{for(const field of detailFieldNames){const el=form.elements.namedItem(field) as HTMLInputElement|HTMLSelectElement|null;if(!el)continue;const value=values[field];if(value===null||value===undefined)continue;if(el instanceof HTMLSelectElement&&![...el.options].some(o=>o.value===value))el.add(new Option(value,value));el.value=toEditInput(field,value);}financial.sync();};
 const values=():DetailFields=>{const result={...draft.values};for(const field of detailFieldNames){const el=form.elements.namedItem(field) as HTMLInputElement|HTMLSelectElement|null;if(el&&(field!=='category'||draft.base.category!==null))result[field]=fromEditInput(field,el.value);}return result;};
 const removeSource=()=>{if(sourceKey&&sourceKey!==key&&localStorage.getItem(sourceKey)===sourceRaw)localStorage.removeItem(sourceKey);sourceKey=undefined;sourceRaw=null;};
 const persist=()=>{
  draft={...draft,values:values(),updatedAt:new Date().toISOString()};
  try{writeDetailDraft(localStorage,key,draft);}catch{status.textContent='草稿暂存失败，请保留此页面并重试保存，不要关闭或刷新。';throw Error('DETAIL_DRAFT_STORAGE_FAILED');}
  status.textContent=Object.keys(changedDetailFields(draft.base,draft.values)).length?'修改已暂存在本机，尚未保存到账单。':'尚无未保存的修改。';
 };
 setValues(draft.values);active={persist,saving:()=>saving};
 const onInput=()=>{if(saving)return;try{persist();}catch(e){input.error(e);}};form.addEventListener('input',onInput);form.addEventListener('change',onInput);
 // Copy recovered data before letting the source draft be removed.
 if(original){persist();removeSource();status.textContent='已恢复本机草稿，尚未保存到账单。';}
 else status.textContent='修改会暂存在本机；点击保存修改后才会更新账单。';
 const latest=async()=>{
  persist();const state=await read();let next:ReturnType<typeof transactionEditContext>;
  try{next=transactionEditContext(project(state.ops),id);}catch{comparison.textContent='这笔账单已删除或不可用。你的修改仍保留在本机，可以复制输入内容，或放弃草稿。';return;}
  const changes=changedDetailFields(draft.base,draft.values);
  const labels=detailLabels;
  comparison.innerHTML=`<p>对比最新账单与草稿。确认继续只更新编辑基准，不会立即改账。</p><div class="detail-comparison">${detailFieldNames.filter(k=>draft.base[k]!==next.fields[k]||Object.hasOwn(changes,k)).map(k=>`<p><strong>${labels[k]}</strong><br>开始编辑时：${esc(financial.display(k,draft.base[k]))}<br>最新账单：${esc(financial.display(k,next.fields[k]))}<br>你的修改：${esc(financial.display(k,draft.values[k]))}</p>`).join('')}</div><p>最新金额：${(Number(next.transaction.fields.display_amount)/100).toFixed(2)} 元；时间：${esc(next.transaction.fields.occurred_at)}。来源、状态或关联也可能已变化。</p><button type="button" data-detail-rebase>保留我的修改，按最新账单继续编辑</button>`;
  comparison.querySelector<HTMLButtonElement>('[data-detail-rebase]')!.onclick=()=>{
   if(saving)return;
   if(Object.hasOwn(changes,'category')&&next.fields.category===null){comparison.insertAdjacentHTML('beforeend','<p>最新账单已没有可编辑的消费分类，请先放弃分类修改。</p>');return;}
   draft={...draft,base:next.fields,expectedSnapshot:next.expectedSnapshot,values:{...next.fields,...changes}};setValues(draft.values);persist();comparison.innerHTML='';
  };
 };
 controls.querySelector<HTMLButtonElement>('[data-detail-latest]')!.onclick=()=>{if(!saving)latest().catch(input.error);};
 controls.querySelector<HTMLButtonElement>('[data-detail-discard]')!.onclick=async()=>{
  if(saving||!confirm('放弃这份未保存的修改？账单本身不会改变。'))return;
  try{localStorage.removeItem(key);removeSource();active=null;await input.done();}catch(e){input.error(e);}
 };
 form.onsubmit=async ev=>{
  ev.preventDefault();if(saving)return;
  try{
   try{persist();}catch{/* Saving the ledger can still succeed when draft storage is full. */}
   saving=true;form.inert=true;form.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
   await saveDetailEdit({transactionId:id,expectedSnapshot:draft.expectedSnapshot,changedFields:changedDetailFields(draft.base,draft.values)});
   // Ledger success precedes draft removal. A storage failure must not report the ledger as failed.
   active=null;
   try{localStorage.removeItem(key);removeSource();}catch{input.error(Error('DETAIL_DRAFT_CLEANUP_FAILED'));}
   await input.done();
  }catch(e){input.error(e);if(e instanceof Error&&e.message==='STALE_TRANSACTION')await latest().catch(input.error);}
  finally{saving=false;form.inert=false;form.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);}
 };
 if(draft.expectedSnapshot!==current.expectedSnapshot)latest().catch(input.error);
}
