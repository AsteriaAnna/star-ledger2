import test from 'node:test';
import assert from 'node:assert/strict';
import {planImportCommit} from '../packages/application/import-commit.ts';
import type {ResolveImportResult,ResolvedImportRecord} from '../packages/application/import-service.ts';
import type {ExternalRecord,ImportSession} from '../packages/importing/types.ts';

const now='2026-10-02T12:00:00Z';
const source=(id:string):ExternalRecord=>({id,sessionId:'s',sourceIdentity:id,sourceType:'EXCEL',sourceSystem:'WECHAT',platformRaw:'微信',profile:'本人',rawPayload:'{}',parserVersion:3,capturedAt:now,facts:{occurredAt:'2026-10-01T10:00:00Z',amountFen:1000,feeFen:0,transactionTypeRaw:'商户消费',directionRaw:'支出',statusRaw:'支付成功',channelRaw:'零钱',counterpartyRaw:'商户',productRaw:'商品',noteRaw:'',sourceCategoryRaw:'',orderId:id,refundId:null,originalOrderId:null,precision:'second'}});
const session:ImportSession={id:'s',sourceType:'EXCEL',sourceSystem:'WECHAT',createdAt:now,updatedAt:now,state:'NEEDS_ATTENTION',sourceCount:5,committedCount:0,skippedDuplicateCount:1,noEffectCount:1,blockingAttentionCount:1,nonBlockingAttentionCount:1,failureCode:null};
const resolved=(id:string,overrides:Partial<ResolvedImportRecord>={}):ResolvedImportRecord=>({
 externalRecordId:id,disposition:'INTERPRETED',transactionId:null,ledgerState:'READY_FOR_LEDGER',
 interpretation:{externalRecordId:id,eventKind:'PURCHASE',status:'SUCCESS',amountFen:1000,occurredAt:'2026-10-01T10:00:00Z',displayName:'商品',channelRaw:'零钱',categorySuggestion:'餐饮',evidence:[]},
 attention:[],account:{state:'UNRESOLVED',accountId:null,candidates:[],reason:'',memoryKey:null},relation:null,...overrides
});

test('commit plan separates automatic writes from duplicate no-effect and blocking records',()=>{
 const sources=['ready','duplicate','failed','blocked','attention'].map(source);
 const records=[
  resolved('ready'),
  resolved('duplicate',{disposition:'SKIP_DUPLICATE',transactionId:'existing',ledgerState:'NOT_APPLICABLE'}),
  resolved('failed',{disposition:'NO_EFFECT',ledgerState:'NOT_APPLICABLE'}),
  resolved('blocked',{disposition:'NEEDS_ATTENTION',ledgerState:'NEEDS_ATTENTION',attention:[{id:'a1',sessionId:'s',externalRecordId:'blocked',kind:'SPLIT_PAYMENT',question:'分摊？',blocking:true,candidates:[],createdAt:now}]}),
  resolved('attention',{attention:[{id:'a2',sessionId:'s',externalRecordId:'attention',kind:'ACCOUNT',question:'账户？',blocking:false,candidates:[],createdAt:now}]})
 ];
 const plan=planImportCommit({session,records},sources);
 assert.equal(plan.newRecords.length,2);
 assert.deepEqual(plan.skippedDuplicateIds,['duplicate']);assert.deepEqual(plan.noEffectRecordIds,['failed']);assert.deepEqual(plan.blockedRecordIds,['blocked']);
 assert.deepEqual(plan.attentionRecordIds.sort(),['attention','blocked']);
});

test('non-blocking attention never prevents a known financial fact from committing',()=>{
 const r=source('refund'),row=resolved('refund',{interpretation:{...resolved('refund').interpretation,eventKind:'REFUND'},attention:[{id:'a',sessionId:'s',externalRecordId:'refund',kind:'REFUND_RELATION',question:'可能对应哪笔？',blocking:false,candidates:[],createdAt:now}]});
 const plan=planImportCommit({session:{...session,sourceCount:1},records:[row]},[r]);
 assert.equal(plan.newRecords.length,1);assert.equal(plan.newRecords[0].intent.kind,'REFUND');assert.deepEqual(plan.blockedRecordIds,[]);
});

test('revive plan preserves existing transaction identity instead of creating a second economic record',()=>{
 const r=source('revive'),row=resolved('revive',{disposition:'REVIVE_EXISTING',transactionId:'old-transaction',ledgerState:'NOT_APPLICABLE'});
 const plan=planImportCommit({session:{...session,sourceCount:1},records:[row]},[r]);
 assert.equal(plan.newRecords.length,0);assert.equal(plan.revivals.length,1);assert.equal(plan.revivals[0].transactionId,'old-transaction');assert.equal('replacement' in plan.revivals[0],false);
});

test('commit planning fails if a resolved record has lost its source evidence',()=>{
 assert.throws(()=>planImportCommit({session:{...session,sourceCount:1},records:[resolved('missing')]},[]),/MISSING_EXTERNAL_RECORD/);
});


test('changed source evidence plans an evidence-only attachment while accounting stays blocked',()=>{
 const r={...source('update'),rawPayload:'changed-official-row'};
 const row=resolved('update',{disposition:'SOURCE_UPDATE',transactionId:'existing',ledgerState:'NEEDS_ATTENTION',attention:[{id:'u',sessionId:'s',externalRecordId:'update',kind:'SOURCE_UPDATE',question:'来源更新',blocking:true,candidates:[{id:'existing',label:'existing'}],createdAt:now}]});
 const plan=planImportCommit({session:{...session,sourceCount:1},records:[row]},[r]);
 assert.equal(plan.evidenceUpdates.length,1);assert.equal(plan.evidenceUpdates[0].transactionId,'existing');
 assert.deepEqual(plan.blockedRecordIds,['update']);assert.equal(plan.newRecords.length,0);
});
