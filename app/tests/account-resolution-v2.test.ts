import test from 'node:test';
import assert from 'node:assert/strict';
import type {Entity} from '../packages/domain/index.ts';
import {describeFundingChannel,paymentChannel} from '../packages/importing/channel.ts';
import {resolveAccount} from '../packages/importing/account-resolution.ts';

const account=(id:string,name:string,type:'ASSET'|'LIABILITY',last4=''):Entity=>({type:'accounts',id,fields:{name,type,last4,deleted_at:null,balance_tracking:'ENABLED',balance_state:'ESTABLISHED',opening_balance:0,opening_balance_at:'2026-01-01T00:00:00Z'}});

test('checkout discount token is not treated as a second funding account',()=>{
 const p=paymentChannel('招商银行储蓄卡(1234)&支付宝红包');assert.equal(p.compound,false);assert.equal(p.channel,'招商银行储蓄卡(1234)');assert.deepEqual(p.discounts,['支付宝红包']);
});
test('funding channel descriptor preserves bank/card identity',()=>{
 const d=describeFundingChannel('支付宝','招商银行储蓄卡(1234)')!;assert.equal(d.type,'ASSET');assert.equal(d.last4,'1234');assert.equal(d.identity,'招商银行:debit:1234');
});
test('unique explicit channel resolves without user confirmation',()=>{
 const entities=[account('a1','招商银行卡(1234)','ASSET','1234'),account('a2','工资卡','ASSET','5678')];
 const r=resolveAccount({eventKind:'PURCHASE',platform:'支付宝',profile:'本人',channelRaw:'招商银行储蓄卡(1234)',role:'ACCOUNT',sponsored:false},entities,[]);
 assert.equal(r.state,'RESOLVED');assert.equal(r.accountId,'a1');
});
test('remembered account wins when still valid',()=>{
 const entities=[account('a1','自定义名称','ASSET','')];
 const r=resolveAccount({eventKind:'PURCHASE',platform:'支付宝',profile:'本人',channelRaw:'余额',role:'ACCOUNT',sponsored:false,rememberedAccountId:'a1'},entities,[]);
 assert.equal(r.state,'RESOLVED');assert.equal(r.accountId,'a1');assert.equal(r.reason,'使用已确认的账户关系');
});
test('compound funding never guesses one account',()=>{
 const r=resolveAccount({eventKind:'PURCHASE',platform:'支付宝',profile:'本人',channelRaw:'余额+招商银行储蓄卡(1234)',role:'ACCOUNT',sponsored:false},[account('a1','支付宝余额','ASSET')],[]);
 assert.equal(r.state,'SPLIT');assert.equal(r.accountId,null);
});
test('sponsored purchase has no own-account question',()=>{
 const r=resolveAccount({eventKind:'PURCHASE',platform:'微信',profile:'本人',channelRaw:'亲属卡',role:'ACCOUNT',sponsored:true},[],[]);
 assert.equal(r.state,'NOT_APPLICABLE');
});
