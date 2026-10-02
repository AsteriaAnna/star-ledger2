import test from 'node:test';
import assert from 'node:assert/strict';
import type {Entity} from '../packages/domain/index.ts';
import {refundAnnotation,resolveRefundRelation} from '../packages/importing/relation-resolution.ts';

const tx=(id:string,amount=123456):Entity=>({type:'transactions',id,fields:{event_type:'PURCHASE',status:'SUCCESS',occurred_at:'2026-09-01T00:00:00Z',display_amount:amount,display_name:'盒马',note:'',created_at:'2026-09-01T00:00:00Z',deleted_at:null,purged_at:null}});
const source=(id:string,transactionId:string,order:string,status=''):Entity=>({type:'source_records',id,fields:{transaction_id:transactionId,source_type:'EXCEL',platform:'微信',raw_payload:JSON.stringify({order,profile:'本人',original:JSON.stringify({'当前状态':status})}),created_at:'2026-09-01T00:00:00Z'}});
const input={kind:'REFUND' as const,amountFen:123456,occurredAt:'2026-09-20T00:00:00Z',platform:'微信',profile:'本人',displayName:'盒马退款',originalOrderId:null,orderId:'refund-1',statusRaw:'',productRaw:''};

test('refund annotation parses thousands separators',()=>{assert.deepEqual(refundAnnotation('已退款(¥1,234.56)'),{kind:'partial',amountFen:123456});});
test('strong original order identity auto-resolves refund relation',()=>{
 const result=resolveRefundRelation({...input,originalOrderId:'order-1'},[tx('t1'),source('s1','t1','order-1')]);
 assert.equal(result.state,'RESOLVED');assert.equal(result.originalId,'t1');assert.equal(result.evidence,'ORIGINAL_ORDER');
});
test('platform refund annotation can auto-resolve unique relation',()=>{
 const result=resolveRefundRelation({...input,statusRaw:'已退款(¥1,234.56)'},[tx('t1'),source('s1','t1','order-1','已退款(¥1,234.56)')]);
 assert.equal(result.state,'RESOLVED');assert.equal(result.evidence,'REFUND_ANNOTATION');
});
test('merchant amount time fallback is suggestion-only, never silent auto-link',()=>{
 const result=resolveRefundRelation(input,[tx('t1')]);
 assert.equal(result.state,'SUGGESTED');assert.deepEqual(result.candidates,['t1']);assert.equal(result.evidence,'MERCHANT_AMOUNT_TIME');
});
test('unlinked refund remains a valid unresolved relation, not a blocking accounting failure',()=>{
 const result=resolveRefundRelation({...input,displayName:'不存在的商户'},[]);
 assert.equal(result.state,'UNRESOLVED');assert.equal(result.originalId,null);
});

test('missing strong order match may fall back only to a weak suggestion',()=>{
 const result=resolveRefundRelation({...input,originalOrderId:'missing-order'},[tx('t1')]);
 assert.equal(result.state,'SUGGESTED');assert.equal(result.originalId,null);assert.equal(result.evidence,'MERCHANT_AMOUNT_TIME');
});
