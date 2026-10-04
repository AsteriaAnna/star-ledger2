import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {completeImportSessionFromOutcomes,importRecordOutcomes,mergeImportOutcomes,planImportExecution} from '../packages/application/import-execution.ts';
import {pair} from './helpers.ts';
import {project} from '../packages/sync/projection.ts';

const at='2026-10-02T10:00:00Z';
const intent=(id:string,amount=1000)=>({kind:'PURCHASE' as const,id,name:id,amount,occurredAt:at,payer:null,categoryId:'餐饮',funding:'OWN' as const});

test('import execution creates all new intents in one validated command batch',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a'),snapshot=()=>project(p.a.store.allOperations());
 const execution=planImportExecution({evidenceUpdates:[],newRecords:[{externalRecordId:'ra',intent:intent('a')},{externalRecordId:'rb',intent:intent('b')}],revivals:[],skippedDuplicateIds:['dup'],noEffectRecordIds:['failed'],blockedRecordIds:['blocked'],attentionRecordIds:['blocked']},snapshot(),at);
 service.executeBatch(execution.commands);
 assert.ok(p.a.store.get('transactions','a'));assert.ok(p.a.store.get('transactions','b'));
 assert.deepEqual(execution.createdIds,['a','b']);assert.deepEqual(execution.skippedDuplicateIds,['dup']);
});

test('deleted imported transaction restores without replacing user facts in the same accounting batch',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute(intent('old',1000));service.execute({kind:'DELETE_TRANSACTION',transactionId:'old',deletedAt:'2026-10-02T11:00:00Z'});
 const execution=planImportExecution({evidenceUpdates:[],newRecords:[],revivals:[{transactionId:'old',externalRecordId:'source'}],skippedDuplicateIds:[],noEffectRecordIds:[],blockedRecordIds:[],attentionRecordIds:[]},project(p.a.store.allOperations()),at);
 service.executeBatch(execution.commands);
 const tx=p.a.store.get('transactions','old');assert.equal(tx?.fields.deleted_at,null);assert.equal(tx?.fields.display_amount,1000);
 assert.equal(p.a.store.get('consumption_effects','old:effect')?.fields.amount,1000);assert.deepEqual(execution.revivedIds,['old']);
});

test('invalid later intent prevents the whole import accounting batch from partially committing',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 assert.throws(()=>planImportExecution({evidenceUpdates:[],newRecords:[{externalRecordId:'good-source',intent:intent('good')},{externalRecordId:'bad-source',intent:{...intent('bad'),amount:-1}}],revivals:[],skippedDuplicateIds:[],noEffectRecordIds:[],blockedRecordIds:[],attentionRecordIds:[]},project(p.a.store.allOperations()),at),/INVALID_MONEY/);
 assert.equal(p.a.store.get('transactions','good'),undefined);assert.equal(p.a.store.get('transactions','bad'),undefined);
});

test('purged transaction cannot be revived by reimport',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute(intent('old'));service.execute({kind:'DELETE_TRANSACTION',transactionId:'old',deletedAt:'2026-10-02T11:00:00Z'});
 p.a.service.execute([{action:'PATCH_FIELD',entity:{type:'transactions',id:'old',fields:{purged_at:'2026-10-02T11:30:00Z'}}}]);
 assert.throws(()=>planImportExecution({evidenceUpdates:[],newRecords:[],revivals:[{transactionId:'old',externalRecordId:'source'}],skippedDuplicateIds:[],noEffectRecordIds:[],blockedRecordIds:[],attentionRecordIds:[]},project(p.a.store.allOperations()),at),/TRANSACTION_UNAVAILABLE/);
});


test('session recovery keeps prior committed outcomes distinct from pre-existing duplicates',()=>{
 const base={id:'s',sourceType:'EXCEL' as const,sourceSystem:'WECHAT' as const,createdAt:at,updatedAt:at,state:'NEEDS_ATTENTION' as const,sourceCount:3,committedCount:1,skippedDuplicateCount:0,noEffectCount:0,blockingAttentionCount:1,nonBlockingAttentionCount:0,failureCode:null};
 const prior=[{sessionId:'s',externalRecordId:'already',state:'COMMITTED' as const,transactionId:'tx-already',updatedAt:at},{sessionId:'s',externalRecordId:'duplicate',state:'SKIPPED_DUPLICATE' as const,transactionId:null,updatedAt:at}];
 const later=[{sessionId:'s',externalRecordId:'blocked',state:'COMMITTED' as const,transactionId:'tx-blocked',updatedAt:'2026-10-02T12:00:00Z'}];
 const merged=mergeImportOutcomes(prior,later),session=completeImportSessionFromOutcomes(base,merged,[],'2026-10-02T12:00:00Z');
 assert.equal(session.committedCount,2);assert.equal(session.skippedDuplicateCount,1);assert.equal(session.state,'COMPLETED');
});

test('execution outcomes preserve external record identity instead of inferring it from transaction ids',()=>{
 const execution={commands:[],createdIds:['tx-a'],createdRecordIds:['source-a'],revivedIds:['old-tx'],revivedRecordIds:['source-old'],skippedDuplicateIds:['source-dup'],noEffectRecordIds:['source-failed'],blockedRecordIds:['source-blocked']};
 const outcomes=importRecordOutcomes('s',execution,at);
 assert.deepEqual(outcomes.map(x=>[x.externalRecordId,x.state]).sort(),[['source-a','COMMITTED'],['source-blocked','BLOCKED'],['source-dup','SKIPPED_DUPLICATE'],['source-failed','NO_EFFECT'],['source-old','COMMITTED']].sort());
});


test('changed source evidence appends immutably without changing accounting facts',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute({...intent('existing'),source:{id:'old-evidence',sourceType:'EXCEL',platform:'微信',rawPayload:'old',capturedAt:at}});
 const before=p.a.store.get('transactions','existing')?.fields.display_amount;
 const source={id:'new-evidence',sourceType:'EXCEL' as const,platform:'微信',rawPayload:'new',capturedAt:'2026-10-02T12:00:00Z'};
 const execution=planImportExecution({evidenceUpdates:[{externalRecordId:'row',transactionId:'existing',source}],newRecords:[],revivals:[],skippedDuplicateIds:[],noEffectRecordIds:[],blockedRecordIds:['row'],attentionRecordIds:['row']},project(p.a.store.allOperations()),'2026-10-02T12:00:00Z');
 service.executeBatch(execution.commands);
 assert.equal(p.a.store.get('transactions','existing')?.fields.display_amount,before);
 assert.equal(p.a.store.get('source_records','old-evidence')?.fields.raw_payload,'old');
 assert.equal(p.a.store.get('source_records','new-evidence')?.fields.raw_payload,'new');
});
