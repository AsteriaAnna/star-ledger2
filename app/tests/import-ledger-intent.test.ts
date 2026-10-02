import test from 'node:test';
import assert from 'node:assert/strict';
import type {Entity} from '../packages/domain/index.ts';
import type {EventInterpretation,ExternalRecord} from '../packages/importing/types.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import {buildImportedLedgerIntent,importedSourceRecordId,importedTransactionId} from '../packages/application/import-ledger-intent.ts';
import {interpret} from '../packages/accounting/business.ts';

const record=(id:string,channel='某银行储蓄卡(1234)'):ExternalRecord=>({id,sessionId:'s',sourceIdentity:id,sourceType:'EXCEL',sourceSystem:'ALIPAY',platformRaw:'支付宝',profile:'本人',rawPayload:'{}',parserVersion:3,capturedAt:'2026-10-02T00:00:00Z',facts:{occurredAt:'2026-09-20T04:00:00Z',amountFen:1000,feeFen:0,transactionTypeRaw:'消费',directionRaw:'支出',statusRaw:'交易成功',channelRaw:channel,counterpartyRaw:'商户',productRaw:'商品',noteRaw:'',sourceCategoryRaw:'',orderId:id,refundId:null,originalOrderId:null,precision:'second'}});
const interpretation=(id:string,kind:EventInterpretation['eventKind']='PURCHASE'):EventInterpretation=>({externalRecordId:id,eventKind:kind,status:'SUCCESS',amountFen:1000,occurredAt:'2026-09-20T04:00:00Z',displayName:'商品',channelRaw:'某银行储蓄卡(1234)',categorySuggestion:'购物',evidence:[]});
async function resolve(r:ExternalRecord,i:EventInterpretation,entities:Entity[]=[]){
 const service=new ImportStatementService(new InMemoryImportWorkspace()),ledger={entities,conflicts:[]};
 const prepared=await service.prepare({sessionId:'s',sourceType:r.sourceType,sourceSystem:r.sourceSystem,records:[r],interpretations:[i],ledger,now:'2026-10-02T00:00:00Z'});
 const result=await service.resolve({prepared,records:[r],ledger,now:'2026-10-02T00:00:01Z'});
 return {record:result.records[0],ledger};
}

test('ready purchase with unknown account creates unresolved movement rather than sponsor semantics',async()=>{
 const r=record('purchase'),out=await resolve(r,interpretation(r.id));
 assert.equal(out.record.ledgerState,'READY_FOR_LEDGER');
 const intent=buildImportedLedgerIntent({resolved:out.record,source:r});
 assert.equal(intent.kind,'PURCHASE');if(intent.kind!=='PURCHASE')return;
 assert.equal(intent.payer,null);assert.equal(intent.funding,'OWN');assert.equal(intent.categoryId,undefined);
 const commands=interpret(intent,out.ledger);
 const movement=commands.find(x=>x.entity.type==='balance_movements')!.entity;
 assert.equal(movement.fields.account_id,null);
 assert.equal(commands.find(x=>x.entity.type==='consumption_effects')!.entity.fields.amount,1000);
});

test('ordinary external transfer remains zero consumption in ledger intent',async()=>{
 const r=record('transfer'),i={...interpretation(r.id,'EXTERNAL_TRANSFER'),channelRaw:r.facts.channelRaw};
 const out=await resolve(r,i),intent=buildImportedLedgerIntent({resolved:out.record,source:r});
 assert.equal(intent.kind,'EXTERNAL_TRANSFER');if(intent.kind!=='EXTERNAL_TRANSFER')return;
 assert.equal(intent.consumptionAmount,0);
});

test('namespaced source identity generates stable transaction and evidence ids',async()=>{
 const r=record('stable-source'),out=await resolve(r,interpretation(r.id)),intent=buildImportedLedgerIntent({resolved:out.record,source:r});
 assert.equal(intent.id,importedTransactionId(r));assert.equal(intent.source?.id,importedSourceRecordId(r));
 const payload=JSON.parse(intent.source!.rawPayload);assert.equal(payload.identity,'stable-source');assert.equal(payload.version,3);
});

test('withdrawal with unknown fee never reaches ledger-intent builder as ready',async()=>{
 const r=record('withdrawal');r.facts.feeFen=null;
 const out=await resolve(r,{...interpretation(r.id,'WITHDRAWAL'),channelRaw:r.facts.channelRaw});
 assert.equal(out.record.ledgerState,'NEEDS_ATTENTION');assert.equal(out.record.attention.some(x=>x.kind==='AMOUNT'&&x.blocking),true);
 assert.throws(()=>buildImportedLedgerIntent({resolved:out.record,source:r}),/IMPORT_NOT_READY_FOR_LEDGER/);
});


test('same raw source identity in different profiles cannot collide',async()=>{
 const mine=record('same-order'),other={...record('same-order'),profile:'另一个账本身份'};
 const a=await resolve(mine,interpretation(mine.id)),b=await resolve(other,interpretation(other.id));
 const ia=buildImportedLedgerIntent({resolved:a.record,source:mine}),ib=buildImportedLedgerIntent({resolved:b.record,source:other});
 assert.notEqual(ia.id,ib.id);assert.notEqual(ia.source?.id,ib.source?.id);
});


test('recognized repayment reaches ledger with unresolved liability endpoint instead of blocking import',async()=>{
 const r=record('repayment'),i={...interpretation(r.id,'REPAYMENT'),channelRaw:r.facts.channelRaw};
 const out=await resolve(r,i);
 assert.equal(out.record.ledgerState,'READY_FOR_LEDGER');assert.equal(out.record.attention.some(x=>x.kind==='TRANSFER_ENDPOINTS'&&x.blocking),false);
 const intent=buildImportedLedgerIntent({resolved:out.record,source:r});assert.equal(intent.kind,'REPAYMENT');
 if(intent.kind==='REPAYMENT'){assert.equal(intent.to,null);}
});


test('changed raw evidence keeps transaction identity but gets a new immutable SourceRecord id',async()=>{
 const first=record('evolving'),second={...record('evolving'),rawPayload:'{"status":"updated"}'};
 assert.equal(importedTransactionId(first),importedTransactionId(second));
 assert.notEqual(importedSourceRecordId(first),importedSourceRecordId(second));
 assert.equal(importedSourceRecordId(first),importedSourceRecordId({...first}));
});
