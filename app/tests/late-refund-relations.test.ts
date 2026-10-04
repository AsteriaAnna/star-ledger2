import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore,fresh} from '../apps/web/src/store.ts';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {AccountingService} from '../packages/accounting/index.ts';
import {planLateRefundRelations,refreshRefundAttention} from '../packages/application/late-refund-relations.ts';
import {refundRelationContext,planRefundRelation} from '../packages/application/refund-relations.ts';
import {planImportExecution} from '../packages/application/import-execution.ts';
import type {ImportCommitPlan} from '../packages/application/import-commit.ts';
import type {ImportWorkspaceSnapshot} from '../packages/importing/workspace.ts';
const at='2026-10-04T01:00:00Z';
const source=(id:string,order:string,profile='本人',originalOrder:string|null=null)=>({id:'s-'+id,sourceType:'EXCEL' as const,platform:'支付宝',rawPayload:JSON.stringify({version:3,profile,order,originalOrder})});
function fixture(){
 const store=new MemoryStore(fresh()),business=new BusinessAccountingService(store,store.state.device);
 const snap=()=>({entities:store.entities,conflicts:store.conflicts});
 const refund=(id='r',amount=500,profile='本人')=>business.execute({kind:'REFUND',id,name:'退款',amount,destination:null,originalId:null,occurredAt:at,source:source(id,'order*REFUND_'+(id.replace(/\D/g,'')||'1'),profile)});
 const original=(id='p',amount=2000,profile='本人',order='order')=>business.execute({kind:'PURCHASE',id,name:'原消费',amount,payer:null,categoryId:'餐饮',occurredAt:'2026-09-30T01:00:00Z',source:source(id,order,profile)});
 const finish=()=>business.executeBatch(planLateRefundRelations(snap()));
 return {store,business,snap,refund,original,finish};
}
function workspace():ImportWorkspaceSnapshot{return {sessions:{old:{id:'old',sourceType:'EXCEL',sourceSystem:'ALIPAY',createdAt:at,updatedAt:at,state:'COMPLETED',sourceCount:1,committedCount:1,skippedDuplicateCount:0,noEffectCount:0,blockingAttentionCount:0,nonBlockingAttentionCount:1,failureCode:null}},records:{old:[]},outcomes:{old:[{sessionId:'old',externalRecordId:'record-r',transactionId:'r',state:'COMMITTED',updatedAt:at}]},attention:{old:[{id:'question',sessionId:'old',externalRecordId:'record-r',kind:'REFUND_RELATION',question:'选择原消费',blocking:false,candidates:[],createdAt:at}]}};}
test('late original commit links earlier refunds once and removes the old session question without changing outcomes or evidence',()=>{
 const h=fixture();h.refund();h.refund('r2',300);const before=structuredClone(h.store.entities.filter(e=>e.type==='balance_movements'||e.type==='source_records'));
 const plan:ImportCommitPlan={newRecords:[{externalRecordId:'record-p',intent:{kind:'PURCHASE',id:'p',name:'原消费',amount:2000,payer:null,categoryId:'餐饮',occurredAt:'2026-09-30T01:00:00Z',source:source('p','order')}}],evidenceUpdates:[],revivals:[],skippedDuplicateIds:[],noEffectRecordIds:[],blockedRecordIds:[],attentionRecordIds:[]};
 const execution=planImportExecution(plan,h.snap(),at);assert.equal(execution.commands.filter(c=>c.kind==='LINK_RETURN').length,2);h.business.executeBatch(execution.commands);
 assert.deepEqual(planLateRefundRelations(h.snap()),[]);for(const row of before)assert.deepEqual(h.store.entities.find(e=>e.type===row.type&&e.id===row.id),row);
 const old=workspace(),next=refreshRefundAttention(old,h.snap(),at);assert.deepEqual(next.outcomes,old.outcomes);assert.equal(next.attention.old.length,0);assert.equal(next.sessions.old.nonBlockingAttentionCount,0);assert.equal(next.sessions.old.state,'COMPLETED');
 assert.equal(h.store.entities.find(e=>e.id==='r:effect')?.fields.effective_at,at);
});
test('weak merchant match, another profile, ambiguous order and contradicting evidence never auto-link',()=>{
 for(const mode of ['weak','profile','ambiguous','contradicting']){
  const h=fixture();h.refund();h.original('p',2000,mode==='profile'?'家人':'本人',mode==='weak'?'different':'order');
  if(mode==='ambiguous')h.original('p2');
  if(mode==='contradicting'){h.business.execute({kind:'ATTACH_SOURCE_EVIDENCE',transactionId:'r',source:source('extra','other*REFUND_1')});h.original('p2',2000,'本人','other');}
  assert.deepEqual(planLateRefundRelations(h.snap()),[]);
 }
});
test('complete over-limit refund group remains unlinked rather than committing a subset',()=>{
 const h=fixture();h.refund('r1',700);h.refund('r2',700);h.original('p',1000);assert.deepEqual(planLateRefundRelations(h.snap()),[]);assert.equal(h.store.entities.filter(e=>e.type==='transaction_links').length,0);
});
test('explicitly keeping a refund unlinked is respected after later original import',()=>{
 const h=fixture();h.refund();new AccountingService(h.store,h.store.state.device).execute(s=>planRefundRelation({transactionId:'r',originalId:null,expectedSnapshot:refundRelationContext(s,'r').expectedSnapshot,now:at},s));h.original();assert.deepEqual(planLateRefundRelations(h.snap()),[]);assert.equal(refreshRefundAttention(workspace(),h.snap(),at).attention.old.length,0);
});
test('failed original and refund link write rolls back the entire import batch',()=>{
 const h=fixture();h.refund();const before=structuredClone(h.store.state),append=h.store.append.bind(h.store);let writes=0;
 h.store.append=(op,local)=>{append(op,local);if(++writes===3)throw Error('WRITE_FAILURE');};
 const plan:ImportCommitPlan={newRecords:[{externalRecordId:'p',intent:{kind:'PURCHASE',id:'p',name:'原消费',amount:2000,payer:null,occurredAt:'2026-09-30T01:00:00Z',source:source('p','order')}}],evidenceUpdates:[],revivals:[],skippedDuplicateIds:[],noEffectRecordIds:[],blockedRecordIds:[],attentionRecordIds:[]};
 assert.throws(()=>h.business.executeBatch(planImportExecution(plan,h.snap(),at).commands),/WRITE_FAILURE/);assert.deepEqual(h.store.state,before);
});

import {planDetailEdit,transactionEditContext} from '../packages/application/transaction-edit.ts';
test('late automatic relation does not silently replace a user-edited refund category',()=>{
 const h=fixture();h.refund();new AccountingService(h.store,h.store.state.device).execute(s=>planDetailEdit({transactionId:'r',expectedSnapshot:transactionEditContext(s,'r').expectedSnapshot,changedFields:{category:'购物'}},s));h.original();assert.deepEqual(planLateRefundRelations(h.snap()),[]);assert.equal(h.store.entities.find(e=>e.id==='r:effect')?.fields.category_id,'购物');
});

test('an invalidated formerly selected original keeps its local relationship question',()=>{
 const h=fixture();h.refund();h.original();new AccountingService(h.store,h.store.state.device).execute(s=>planRefundRelation({transactionId:'r',originalId:'p',expectedSnapshot:refundRelationContext(s,'r').expectedSnapshot,now:at},s));
 h.business.execute({kind:'UNLINK_RETURN',transactionId:'r',detachedAt:at});assert.equal(refreshRefundAttention(workspace(),h.snap(),at).attention.old.length,1);
});
