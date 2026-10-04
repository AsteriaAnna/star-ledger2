import type {DetailFields} from '../../../packages/application/transaction-edit.ts';
import type {LedgerSnapshot} from '../../../packages/accounting/index.ts';
import {ledgerWall,sourceUTC} from './normalize.ts';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const detailLabels:Record<string,string>={name:'名称',note:'备注',category:'分类',amount:'金额',occurredAt:'发生时间',meaning:'交易性质',funding:'付款归属',account:'付款或到账账户',to:'转入账户',fee:'手续费',consumption:'计入消费',allocations:'各账户金额'};
export const meanings:Record<string,string>={PURCHASE:'消费',INCOME:'收入',TRANSFER_IN:'他人转入',INTERNAL_TRANSFER:'自己账户互转',EXTERNAL_TRANSFER:'转给别人',REPAYMENT:'还款',WITHDRAWAL:'提现',REFUND:'消费退款',RETURN:'转账退回',DEPOSIT:'押金',RED_PACKET:'红包'};
export function installFinancialFields(form:HTMLFormElement,snapshot:LedgerSnapshot,initial:DetailFields){
 if(initial.amount===undefined){const category=form.elements.namedItem('category') as HTMLSelectElement|null;if(category&&initial.category===null)category.closest('label')!.hidden=true;const hint=document.createElement('p');hint.className='footnote';hint.textContent='这笔旧记录的资金结构暂不能安全还原。目前可修改名称、备注及已有分类，金额和账户暂不开放修改。';form.prepend(hint);return {sync:()=>{},display:(key:string,value:unknown)=>String(value??'')};}
 const accounts=snapshot.entities.filter(e=>e.type==='accounts'&&!e.fields.deleted_at);
 const options=()=>'<option value="">账户暂不确定</option>'+accounts.map(a=>`<option value="${esc(a.id)}">${esc(a.fields.name)} · ${a.fields.type==='LIABILITY'?'负债':'资产'}</option>`).join('');
 const section=document.createElement('fieldset');section.id='detail-financial';section.innerHTML=`<legend>金额、账户与时间</legend><div class="form-grid"><label>金额 · 元<input name="amount" inputmode="decimal" required></label><label>发生时间 · 北京时间<input name="occurredAt" type="datetime-local" step="1" required></label><label>交易性质<select name="meaning">${Object.entries(meanings).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select></label><label data-funding>付款归属<select name="funding"><option value="OWN">本人账户</option><option value="EXTERNAL_SPONSOR">亲情卡 / 他人代付</option></select></label><label data-single-account><span data-account-label>付款账户</span><select name="account">${options()}</select></label><label data-target>转入 / 还款到账账户<select name="to">${options()}</select></label><label data-fee>手续费 · 元<input name="fee" inputmode="decimal"></label><label data-consumption>其中计入消费 · 元<input name="consumption" inputmode="decimal"></label></div><div data-splits><input name="allocations" type="hidden"><div data-allocation-rows></div><button type="button" data-add-allocation>添加组合支付账户</button><button type="button" data-clear-allocations>改为单个账户</button><p class="footnote">多个账户的金额合计必须等于账单金额；系统不会自动平分。</p></div><p class="footnote">修改将同时更新账户流水和消费统计；有效退款关系由系统维护。</p>`;
 form.querySelector('label')!.before(section);
 const input=(name:string)=>form.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement;
 const rows=section.querySelector<HTMLElement>('[data-allocation-rows]')!;
 const renderRows=()=>{
  let allocations:any[]=[];try{allocations=JSON.parse(input('allocations').value||'[]');}catch{}
  rows.innerHTML=allocations.map((a,i)=>`<div class="form-grid" data-allocation-row><label>账户 ${i+1}<select data-allocation-account>${options()}</select></label><label>金额 · 元<input data-allocation-amount inputmode="decimal" value="${esc(a.amountText??(Number(a.amount)/100).toFixed(2))}"></label><button type="button" data-remove-allocation="${i}">移除此账户</button></div>`).join('');
  rows.querySelectorAll<HTMLSelectElement>('[data-allocation-account]').forEach((el,i)=>{const id=allocations[i].accountId??'';if(id&&!accounts.some(a=>a.id===id))el.add(new Option('原账户已不可用',id));el.value=id;});
 };
 const sync=()=>{
  const kind=input('meaning').value,splitKinds=['PURCHASE','REFUND','RETURN'].includes(kind),sponsor=splitKinds&&input('funding').value==='EXTERNAL_SPONSOR';
  const category=form.elements.namedItem('category') as HTMLSelectElement|null;if(category)category.closest('label')!.hidden=!['PURCHASE','EXTERNAL_TRANSFER','DEPOSIT','RED_PACKET'].includes(kind);
  section.querySelector<HTMLElement>('[data-funding]')!.hidden=!splitKinds;
  section.querySelector<HTMLElement>('[data-target]')!.hidden=!['INTERNAL_TRANSFER','REPAYMENT','WITHDRAWAL'].includes(kind);
  section.querySelector<HTMLElement>('[data-fee]')!.hidden=kind!=='WITHDRAWAL';
  section.querySelector<HTMLElement>('[data-consumption]')!.hidden=!['EXTERNAL_TRANSFER','DEPOSIT','RED_PACKET'].includes(kind);
  section.querySelector<HTMLElement>('[data-splits]')!.hidden=!splitKinds||sponsor;
  section.querySelector<HTMLElement>('[data-single-account]')!.hidden=sponsor||(splitKinds&&input('allocations').value!=='[]');
  section.querySelector<HTMLElement>('[data-account-label]')!.textContent=['INCOME','TRANSFER_IN','REFUND','RETURN'].includes(kind)?'到账账户':'付款 / 转出账户';
  renderRows();
 };
 const updateAllocations=()=>{input('allocations').value=JSON.stringify([...rows.querySelectorAll('[data-allocation-row]')].map(row=>({accountId:row.querySelector<HTMLSelectElement>('select')!.value||null,amountText:row.querySelector<HTMLInputElement>('input')!.value})));};
 rows.addEventListener('input',updateAllocations);rows.addEventListener('change',updateAllocations);
 section.addEventListener('change',ev=>{
  const el=ev.target as HTMLInputElement;
  if(el.name==='funding'&&el.value==='EXTERNAL_SPONSOR'){input('account').value='';input('allocations').value='[]';}
  if(el.name==='meaning'||el.name==='funding')sync();
 });
 section.addEventListener('click',ev=>{
  const target=(ev.target as Element).closest<HTMLElement>('button');if(!target)return;
  if(target.hasAttribute('data-add-allocation')){let a=JSON.parse(input('allocations').value||'[]');if(!a.length)a=[{accountId:input('account').value||null,amountText:input('amount').value}];a.push({accountId:null,amountText:''});input('allocations').value=JSON.stringify(a);}
  else if(target.hasAttribute('data-clear-allocations'))input('allocations').value='[]';
  else if(target.dataset.removeAllocation!==undefined){const a=JSON.parse(input('allocations').value);a.splice(Number(target.dataset.removeAllocation),1);input('allocations').value=JSON.stringify(a);}
  else return;
  sync();form.dispatchEvent(new Event('input',{bubbles:true}));
 });
 return {sync,display:(key:string,value:unknown)=>{
  if(key==='meaning')return meanings[String(value)]??String(value??'');
  if(key==='account'||key==='to')return String(accounts.find(a=>a.id===value)?.fields.name??(value?'原账户已不可用':'账户暂不确定'));
  if(key==='occurredAt')return value?ledgerWall(new Date(String(value))).replace('T',' '):'';
  if(key==='funding')return value==='EXTERNAL_SPONSOR'?'亲情卡 / 他人代付':'本人账户';
  if(key==='allocations'){try{return JSON.parse(String(value??'[]')).map((a:any)=>`${accounts.find(v=>v.id===a.accountId)?.fields.name??'账户暂不确定'}：${a.amountText??(a.amount/100).toFixed(2)} 元`).join('；')||'单个账户';}catch{return '组合金额尚未填完整';}}
  return String(value??'');
 }};
}
export const toEditInput=(key:string,value:string)=>key==='occurredAt'&&value.endsWith('Z')&&Number.isFinite(Date.parse(value))?ledgerWall(new Date(value)):value;
export const fromEditInput=(key:string,value:string)=>{if(key!=='occurredAt'||!value)return value;try{return sourceUTC(value);}catch{return value;}};
