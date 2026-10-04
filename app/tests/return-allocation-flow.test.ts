import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {refundRelationContext,planRefundRelation,relationDecision} from '../packages/application/refund-relations.ts';
import {planDetailEdit,transactionEditContext} from '../packages/application/transaction-edit.ts';
import {lifecycleContext,planTransactionLifecycle} from '../packages/application/transaction-lifecycle.ts';
import {resolveReturnAllocation,returnAllocationBounds} from '../packages/domain/return-allocation.ts';
import {refreshRefundAttention} from '../packages/application/late-refund-relations.ts';
import type {ImportWorkspaceSnapshot} from '../packages/importing/workspace.ts';
const at='2026-10-04T01:00:00Z';
function fixture(){
 const store=new MemoryStore(fresh()),business=new BusinessAccountingService(store,store.state.device),service=new AccountingService(store,store.state.device);
 business.execute({kind:'EXTERNAL_TRANSFER',id:'p',name:'转出含消费',amount:10000,from:null,consumptionAmount:3000,categoryId:'购物',occurredAt:at});
 const refund=(id='r',amount=2000)=>business.execute({kind:'RETURN',id,name:'退回',amount,destination:null,originalId:null,occurredAt:at,source:{id:'source-'+id,sourceType:'EXCEL',platform:'支付宝',rawPayload:'immutable'}});
 refund();const snap=()=>({entities:store.entities,conflicts:store.conflicts});
 const request=(id='r',consumptionReduction?:number)=>({transactionId:id,originalId:'p',consumptionReduction,expectedSnapshot:refundRelationContext(snap(),id).expectedSnapshot,now:at});
 const choose=(r:ReturnType<typeof request>)=>service.execute(s=>planRefundRelation(r,s));
 const edit=(id:string,changedFields:any)=>service.execute(s=>planDetailEdit({transactionId:id,expectedSnapshot:transactionEditContext(s,id).expectedSnapshot,changedFields},s));
 const lifecycle=(action:'DELETE'|'RESTORE',ids:string[])=>service.execute(s=>planTransactionLifecycle({action,transactionIds:ids,expectedSnapshot:lifecycleContext(s,action,ids).expectedSnapshot,now:at},s));
 return {store,business,service,refund,snap,request,choose,edit,lifecycle};
}
test('partial return asks only for a genuine unknown range and answering never reposts money or evidence',()=>{
 const h=fixture(),context=refundRelationContext(h.snap(),'r'),before=structuredClone(h.store.entities.filter(e=>e.type==='balance_movements'||e.type==='source_records'));
 assert.equal(context.allocations.p.requiresAnswer,true);assert.deepEqual([context.allocations.p.minimum,context.allocations.p.maximum],[0,2000]);assert.throws(()=>h.choose(h.request()),/CONSUMPTION_ALLOCATION_REQUIRED/);
 h.choose(h.request('r',1000));assert.equal(h.store.entities.find(e=>e.id==='r:effect')?.fields.amount,-1000);assert.equal(relationDecision(h.snap(),'r')?.consumptionReduction,1000);
 assert.deepEqual(h.store.entities.filter(e=>e.type==='balance_movements'||e.type==='source_records'),before);const ops=h.store.state.ops.length;h.choose(h.request());assert.equal(h.store.state.ops.length,ops);
});
test('allocation can be changed on the same relation and retains a valid choice through financial correction and restoration',()=>{
 const h=fixture();h.choose(h.request('r',1000));h.choose(h.request('r',1500));h.edit('p',{amount:'120'});h.edit('r',{amount:'25'});
 assert.equal(h.store.entities.find(e=>e.id==='r:effect')?.fields.amount,-1500);assert.ok(h.store.entities.some(e=>e.type==='transaction_links'&&!e.fields.deleted_at));h.lifecycle('DELETE',['p']);h.lifecycle('RESTORE',['p']);assert.equal(h.store.entities.find(e=>e.id==='r:effect')?.fields.amount,-1500);
});
test('multiple returns enforce consumption and non-consumption caps and infer the final unique amount',()=>{
 const h=fixture();h.choose(h.request('r',1000));h.refund('r2',5000);const before=structuredClone(h.store.state);
 assert.throws(()=>h.choose(h.request('r2',2500)),/REFUND_CONSUMPTION_EXCEEDED/);assert.deepEqual(h.store.state,before);h.choose(h.request('r2',1000));h.refund('r3',3000);
 const context=refundRelationContext(h.snap(),'r3');assert.equal(context.allocations.p.requiresAnswer,false);assert.equal(context.allocations.p.reduction,1000);h.choose(h.request('r3'));assert.equal(h.store.entities.find(e=>e.id==='r3:effect')?.fields.amount,-1000);
});
test('stale allocation and persistence failure keep the old complete financial task intact',()=>{
 const h=fixture(),request=h.request('r',1000);h.edit('p',{note:'其他窗口'});assert.throws(()=>h.choose(request),/STALE_REFUND_RELATION/);
 const before=structuredClone(h.store.state),append=h.store.append.bind(h.store);h.store.append=(op,local)=>{append(op,local);throw Error('WRITE_FAILURE');};assert.throws(()=>h.choose(h.request('r',1000)),/WRITE_FAILURE/);assert.deepEqual(h.store.state,before);
});
test('allocated committed import question is cleared without changing the original outcome',()=>{
 const h=fixture(),workspace:ImportWorkspaceSnapshot={sessions:{s:{id:'s',sourceType:'EXCEL',sourceSystem:'ALIPAY',createdAt:at,updatedAt:at,state:'COMPLETED',sourceCount:1,committedCount:1,skippedDuplicateCount:0,noEffectCount:0,blockingAttentionCount:0,nonBlockingAttentionCount:1,failureCode:null}},records:{s:[]},outcomes:{s:[{sessionId:'s',externalRecordId:'row',transactionId:'r',state:'COMMITTED',updatedAt:at}]},attention:{s:[{id:'question',sessionId:'s',externalRecordId:'row',kind:'CONSUMPTION_ALLOCATION',blocking:false,question:'减少多少消费',candidates:[],createdAt:at}]}};
 h.choose(h.request('r',0));const next=refreshRefundAttention(workspace,h.snap(),at);assert.equal(next.attention.s.length,0);assert.deepEqual(next.outcomes,workspace.outcomes);assert.equal(next.sessions.s.nonBlockingAttentionCount,0);
});
test('domain range infers forced remaining consumption and rejects non-consumption overflow',()=>{
 const values={originalAmount:10000,originalConsumption:3000,previousReturned:7000,previousReduction:2000,amount:3000};assert.deepEqual(returnAllocationBounds(values),{minimum:1000,maximum:1000});assert.deepEqual(resolveReturnAllocation(values),{state:'RESOLVED',reduction:1000});assert.throws(()=>resolveReturnAllocation({...values,requestedReduction:0}),/REFUND_NONCONSUMPTION_EXCEEDED/);
});
