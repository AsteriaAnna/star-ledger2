import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {planDetailEdit,transactionEditContext} from '../packages/application/transaction-edit.ts';
import {changedDetailFields,draftKey,listDetailDrafts,readDetailDraft,writeDetailDraft,type DetailDraft} from '../apps/web/src/detail-drafts.ts';
function fixture(){
 const store=new MemoryStore(fresh()),service=new BusinessAccountingService(store,store.state.device);
 service.execute({kind:'PURCHASE',id:'p',name:'午餐',note:'原备注',amount:1000,payer:null,categoryId:'餐饮',occurredAt:'2026-10-03T10:00:00Z',source:{id:'source',sourceType:'EXCEL',platform:'微信',rawPayload:'immutable'}});
 const snapshot=()=>({entities:store.entities,conflicts:store.conflicts});
 const request=(changedFields:any)=>({transactionId:'p',expectedSnapshot:transactionEditContext(snapshot(),'p').expectedSnapshot,changedFields});
 const execute=(r:ReturnType<typeof request>)=>new AccountingService(store,store.state.device).execute(snap=>planDetailEdit(r,snap));
 return {store,service,snapshot,request,execute};
}
test('changed fields boundary preserves other fields and all financial postings/evidence',()=>{
 const h=fixture(),before=structuredClone(h.store.entities.filter(e=>e.type!=='transactions'));
 h.execute(h.request({note:'改备注'}));
 const context=transactionEditContext(h.snapshot(),'p');assert.equal(context.fields.name,'午餐');assert.equal(context.fields.note,'改备注');
 assert.deepEqual(h.store.entities.filter(e=>e.type!=='transactions'),before);
 assert.deepEqual(planDetailEdit(h.request({note:'改备注'}),h.snapshot()),[]);
});
test('stale edits and unsupported field injection cannot overwrite newer data',()=>{
 const h=fixture(),old=h.request({name:'我的名称'});h.execute(h.request({note:'其他窗口'}));const before=structuredClone(h.store.state);
 assert.throws(()=>h.execute(old),/STALE_TRANSACTION/);assert.deepEqual(h.store.state,before);
 assert.throws(()=>h.execute(h.request({display_amount:1})),/INVALID_DETAIL_EDIT/);assert.deepEqual(h.store.state,before);
});
test('deleted transaction and unresolved conflict reject edits',()=>{
 const h=fixture(),r=h.request({note:'不能写'});h.service.execute({kind:'DELETE_TRANSACTION',transactionId:'p',deletedAt:'2026-10-03T11:00:00Z'});
 assert.throws(()=>h.execute(r),/TRANSACTION_UNAVAILABLE/);
 const h2=fixture();assert.throws(()=>planDetailEdit(h2.request({note:'不能写'}),{...h2.snapshot(),conflicts:[{} as any]}),/UNRESOLVED_CONFLICT/);
});
test('multi-field edit rolls back after storage failure',()=>{
 const h=fixture(),before=structuredClone(h.store.state),append=h.store.append.bind(h.store);
 h.store.append=(op,local)=>{append(op,local);throw Error('WRITE_FAILURE');};
 assert.throws(()=>h.execute(h.request({name:'新名称',note:'新备注',category:'生活'})),/WRITE_FAILURE/);assert.deepEqual(h.store.state,before);
});
test('draft persistence is separate from ledger, scoped to device and editor, and survives reload',()=>{
 const data=new Map<string,string>();const storage={get length(){return data.size;},key:(i:number)=>[...data.keys()][i]??null,getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);},removeItem:(k:string)=>{data.delete(k);}};
 const base={name:'午餐',note:'',category:'餐饮'},draft:DetailDraft={version:1,device:'d1',transactionId:'p',expectedSnapshot:'base-token',base,values:{...base,note:'我的草稿'},updatedAt:'2026-10-03T12:00:00Z'};
 const k1=draftKey('d1','tab1','p'),k2=draftKey('d1','tab2','p');writeDetailDraft(storage,k1,draft);writeDetailDraft(storage,k2,{...draft,values:{...base,note:'另一个窗口'}});
 assert.equal(listDetailDrafts(storage,'d1').length,2);assert.equal(listDetailDrafts(storage,'d2').length,0);
 assert.equal(readDetailDraft(storage,k1,'d1')?.expectedSnapshot,'base-token');assert.equal(readDetailDraft(storage,k2,'d1')?.values.note,'另一个窗口');
 assert.deepEqual(changedDetailFields(draft.base,draft.values),{note:'我的草稿'});
 writeDetailDraft(storage,k1,{...draft,values:base});assert.equal(listDetailDrafts(storage,'d1').length,1);
});
