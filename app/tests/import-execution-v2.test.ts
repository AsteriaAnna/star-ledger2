import test from 'node:test';
import assert from 'node:assert/strict';
import {BusinessAccountingService} from '../packages/accounting/business.ts';
import {planImportExecution} from '../packages/application/import-execution.ts';
import {pair} from './helpers.ts';
import {project} from '../packages/sync/projection.ts';

const at='2026-10-02T10:00:00Z';
const intent=(id:string,amount=1000)=>({kind:'PURCHASE' as const,id,name:id,amount,occurredAt:at,payer:null,categoryId:'餐饮',funding:'OWN' as const});

test('import execution creates all new intents in one validated command batch',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a'),snapshot=()=>project(p.a.store.allOperations());
 const execution=planImportExecution({newIntents:[intent('a'),intent('b')],revivals:[],skippedDuplicateIds:['dup'],noEffectRecordIds:['failed'],blockedRecordIds:['blocked'],attentionRecordIds:['blocked']},snapshot(),at);
 service.executeBatch(execution.commands);
 assert.ok(p.a.store.get('transactions','a'));assert.ok(p.a.store.get('transactions','b'));
 assert.deepEqual(execution.createdIds,['a','b']);assert.deepEqual(execution.skippedDuplicateIds,['dup']);
});

test('deleted imported transaction restores and corrects in the same accounting batch',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute(intent('old',1000));service.execute({kind:'DELETE_TRANSACTION',transactionId:'old',deletedAt:'2026-10-02T11:00:00Z'});
 const replacement=intent('old',2500);
 const execution=planImportExecution({newIntents:[],revivals:[{transactionId:'old',replacement,externalRecordId:'source'}],skippedDuplicateIds:[],noEffectRecordIds:[],blockedRecordIds:[],attentionRecordIds:[]},project(p.a.store.allOperations()),at);
 service.executeBatch(execution.commands);
 const tx=p.a.store.get('transactions','old');assert.equal(tx?.fields.deleted_at,null);assert.equal(tx?.fields.display_amount,2500);
 assert.equal(p.a.store.get('consumption_effects','old:effect')?.fields.amount,2500);assert.deepEqual(execution.revivedIds,['old']);
});

test('invalid later intent prevents the whole import accounting batch from partially committing',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 const execution=planImportExecution({newIntents:[intent('good'),{...intent('bad'),amount:-1}],revivals:[],skippedDuplicateIds:[],noEffectRecordIds:[],blockedRecordIds:[],attentionRecordIds:[]},project(p.a.store.allOperations()),at);
 assert.throws(()=>service.executeBatch(execution.commands),/INVALID_MONEY/);
 assert.equal(p.a.store.get('transactions','good'),undefined);assert.equal(p.a.store.get('transactions','bad'),undefined);
});

test('purged transaction cannot be revived by reimport',t=>{
 const p=pair(t),service=new BusinessAccountingService(p.a.store,'a');
 service.execute(intent('old'));service.execute({kind:'DELETE_TRANSACTION',transactionId:'old',deletedAt:'2026-10-02T11:00:00Z'});
 p.a.service.execute([{action:'PATCH_FIELD',entity:{type:'transactions',id:'old',fields:{purged_at:'2026-10-02T11:30:00Z'}}}]);
 assert.throws(()=>planImportExecution({newIntents:[],revivals:[{transactionId:'old',replacement:intent('old'),externalRecordId:'source'}],skippedDuplicateIds:[],noEffectRecordIds:[],blockedRecordIds:[],attentionRecordIds:[]},project(p.a.store.allOperations()),at),/TRANSACTION_UNAVAILABLE/);
});
