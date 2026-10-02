import test from 'node:test';
import assert from 'node:assert/strict';
import type {Draft} from '../apps/web/src/importer.ts';
import {legacyDraftToExternalRecord,legacyDraftToInterpretation} from '../apps/web/src/import-v2-adapter.ts';

const draft=(patch:Partial<Draft>={}):Draft=>({key:'k',identity:'source',itemId:'item',platform:'微信',name:'提现',amount:'1500.00',date:'2026-09-20T12:00:00',kind:'WITHDRAWAL',status:'SUCCESS',channel:'零钱',account:'',to:'',category:'其他',original:'',note:'',raw:JSON.stringify({'交易类型':'零钱提现','收/支':'支出','当前状态':'提现已到账','支付方式':'零钱','交易单号':'order'}),issue:'',selected:false,sourceType:'EXCEL',order:'order',sponsor:false,consumption:'0',fee:'1.50',profile:'本人',precision:'second',blockers:[],confirmed:[],workflow:'review',parserVersion:3,...patch});

test('legacy bridge preserves withdrawal fee as a normalized source fact',()=>{
 const d=draft(),r=legacyDraftToExternalRecord(d,'session','2026-10-02T00:00:00Z');
 assert.equal(r.facts.amountFen,150000);assert.equal(r.facts.feeFen,150);assert.equal(r.sourceSystem,'WECHAT');
 const i=legacyDraftToInterpretation(d,r);assert.equal(i.eventKind,'WITHDRAWAL');
});

test('legacy bridge does not turn an unknown WeChat withdrawal fee into zero',()=>{
 const d=draft({fee:'0',blockers:['TRANSFER']}),r=legacyDraftToExternalRecord(d,'session','2026-10-02T00:00:00Z');
 assert.equal(r.facts.feeFen,null);
});
