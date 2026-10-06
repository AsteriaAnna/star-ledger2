import test from 'node:test';
import assert from 'node:assert/strict';
import {auditResponse} from '../scripts/audit-capture-evidence.mjs';
const truth={visibleFields:[{role:'支付时间',value:'2026-01-01 12:11'},{role:'amount',value:'44.00'}],identifiers:[{role:'交易单号',value:'0012345678901234'}]};
test('audit does not repair fenced or tailed model output',()=>{
 for(const raw of ['```json\n{}\n```','{}\nextra'])assert.equal(auditResponse(raw,truth).strictJson,false);
});
test('candidate-only facts do not improve evidence coverage',()=>{
 const r=auditResponse(JSON.stringify({evidence:{},candidates:[{amount:'44.00',id:'0012345678901234'}]}),truth);
 assert.equal(r.fields[1].valueFoundSomewhere,false);assert.equal(r.identifiers[0].exactToken,false);
});
test('extra digit and truncated identifier both fail exact token comparison',()=>{
 for(const value of ['00123456789012349','001234567890123'])assert.equal(auditResponse(JSON.stringify({evidence:{identifiers:[{value}]}}),truth).identifiers[0].exactToken,false);
});
test('minute precision is not silently upgraded to seconds; date spelling may normalize',()=>{
 const r=auditResponse(JSON.stringify({evidence:{times:[{role:'支付时间',value:'2026年1月1日12:11:00'}]}}),truth);
 assert.equal(r.fields[0].exactNamedField,false);
 const good=auditResponse(JSON.stringify({evidence:{times:[{role:'支付时间',value:'2026年1月1日12:11'}],identifiers:[{value:'0012345678901234'}]}}),truth);
 assert.equal(good.fields[0].exactNamedField,true);assert.equal(good.identifiers[0].exactToken,true);
});
test('a fact in the wrong field is coverage, not named-field correctness',()=>{
 const r=auditResponse(JSON.stringify({evidence:{merchant:'44.00'}}),truth);
 assert.equal(r.fields[1].valueFoundSomewhere,true);assert.equal(r.fields[1].exactNamedField,false);
});
