import test from 'node:test';
import assert from 'node:assert/strict';
import type {Entity} from '../packages/domain/index.ts';
import type {EventInterpretation,ExternalRecord} from '../packages/importing/types.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import {buildImportedLedgerIntent,importedTransactionId} from '../packages/application/import-ledger-intent.ts';
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

test('import identity generates stable transaction id and immutable source evidence id',async()=>{
 const r=record('stable-source'),out=await resolve(r,interpretation(r.id)),intent=buildImportedLedgerIntent({resolved:out.record,source:r});
 assert.equal(intent.id,importedTransactionId(r));assert.equal(intent.source?.id,'source-stable-source');
 const payload=JSON.parse(intent.source!.rawPayload);assert.equal(payload.identity,'stable-source');assert.equal(payload.version,3);
});

test('withdrawal with unknown fee never reaches ledger-intent builder as ready',async()=>{
 const r=record('withdrawal');r.facts.feeFen=null;
 const out=await resolve(r,{...interpretation(r.id,'WITHDRAWAL'),channelRaw:r.facts.channelRaw});
 assert.equal(out.record.ledgerState,'NEEDS_ATTENTION');assert.equal(out.record.attention.some(x=>x.kind==='AMOUNT'&&x.blocking),true);
 assert.throws(()=>buildImportedLedgerIntent({resolved:out.record,source:r}),/IMPORT_NOT_READY_FOR_LEDGER/);
});
