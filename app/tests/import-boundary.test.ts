import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRows} from '../apps/web/src/importer.ts';
import {legacyDraftToExternalRecord,legacyDraftToInterpretation} from '../apps/web/src/import-v2-adapter.ts';

test('M4 import boundary separates source facts from accounting interpretation',()=>{
 const rows=[
  ['支付宝交易明细'],
  ['交易时间','交易类型','交易对方','商品说明','收/支','金额(元)','收/付款方式','交易状态','交易订单号'],
  ['2026-09-20 12:00:00','商户消费','盒马','午餐','支出','12.34','余额','交易成功','order-1']
 ];
 const draft=parseRows(rows,{profile:'本人'})[0];
 const record=legacyDraftToExternalRecord(draft,'session-1','2026-10-01T12:00:00Z');
 const interpretation=legacyDraftToInterpretation(draft,record);
 assert.equal(record.sourceSystem,'ALIPAY');
 assert.equal(record.sourceIdentity,draft.identity);
 assert.equal(record.facts.amountFen,1234);
 assert.equal(record.facts.directionRaw,'支出');
 assert.equal(record.facts.statusRaw,'交易成功');
 assert.equal(record.facts.orderId,'order-1');
 assert.equal(interpretation.eventKind,'PURCHASE');
 assert.equal(interpretation.status,'SUCCESS');
 assert.equal(interpretation.amountFen,1234);
 assert.equal(interpretation.externalRecordId,record.id);
 assert.equal(interpretation.evidence[0].code,'LEGACY_PARSER_V3');
});

test('M4 interpretation vocabulary preserves existing domain event kinds',()=>{
 const header=['交易时间','交易类型','交易对方','商品说明','收/支','金额(元)','收/付款方式','交易状态','交易订单号'];
 const drafts=parseRows([
  header,
  ['2026-09-20 12:00:00','红包','朋友','红包','支出','10','余额','交易成功','red-1'],
  ['2026-09-20 13:00:00','押金','平台','押金','支出','20','余额','交易成功','deposit-1']
 ],{platform:'支付宝'});
 const kinds=drafts.map((draft,index)=>{
  const record=legacyDraftToExternalRecord(draft,'session-2',`2026-10-01T12:00:0${index}Z`);
  return legacyDraftToInterpretation(draft,record).eventKind;
 });
 assert.deepEqual(kinds,['RED_PACKET','DEPOSIT']);
});
