import test from 'node:test';
import assert from 'node:assert/strict';
import type {Entity} from '../packages/domain/index.ts';
import {accountMappingKey,legacyAccountMemoryMigrations,legacyAccountMemoryMigrationCommands,readAccountMapping,rememberAccountMappingCommand} from '../packages/importing/resolution-memory.ts';

const account=(id:string,name:string):Entity=>({type:'accounts',id,fields:{name,type:'ASSET',balance_tracking:'ENABLED',balance_state:'ESTABLISHED',opening_balance:0,opening_balance_at:'2026-01-01T00:00:00Z',last4:'1234',deleted_at:null}});
const rule=(id:string,value:unknown):Entity=>({type:'import_rules',id,fields:{rule_key:id,value:JSON.stringify(value)}});

test('legacy payer alias migrates to typed PRIMARY account memory',()=>{
 const entities=[account('bank','招商银行卡(1234)'),rule('legacy-a',{v:1,platform:'支付宝',profile:'本人',channel:'招商银行储蓄卡(1234)',role:'付款账户',accountId:'bank'})];
 const migrations=legacyAccountMemoryMigrations(entities,'2026-10-02T06:00:00Z');
 assert.equal(migrations.length,1);assert.deepEqual(migrations[0].key,{sourceSystem:'ALIPAY',profile:'本人',channelKey:'招商银行:debit:1234',role:'PRIMARY'});assert.equal(migrations[0].mapping.accountId,'bank');
});

test('legacy target alias is deliberately not migrated because its old semantics are ambiguous',()=>{
 const entities=[account('bank','招商银行卡(1234)'),rule('legacy-target',{v:1,platform:'支付宝',profile:'本人',channel:'招商银行储蓄卡(1234)',role:'repayment-target',accountId:'bank'})];
 assert.deepEqual(legacyAccountMemoryMigrations(entities,'2026-10-02T06:00:00Z'),[]);
});

test('conflicting legacy memories do not become a typed automatic decision',()=>{
 const entities=[account('a','卡A'),account('b','卡B'),rule('legacy-a',{v:1,platform:'支付宝',profile:'本人',channel:'余额',role:'付款账户',accountId:'a'}),rule('legacy-b',{v:1,platform:'支付宝',profile:'本人',channel:'余额',role:'到账账户',accountId:'b'})];
 assert.deepEqual(legacyAccountMemoryMigrations(entities,'2026-10-02T06:00:00Z'),[]);
});

test('typed memory write is idempotent at one deterministic rule key',()=>{
 const key={sourceSystem:'ALIPAY',profile:'本人',channelKey:'支付宝:余额',role:'PRIMARY'},mapping={accountId:'wallet',rememberedAt:'2026-10-02T06:00:00Z'};
 const create=rememberAccountMappingCommand([],key,mapping);assert.equal(create.action,'CREATE_ENTITY');assert.equal(create.entity.id,accountMappingKey(key));
 const entity={type:'import_rules',id:create.entity.id,fields:{rule_key:create.entity.id,value:JSON.stringify(mapping)}} as Entity;
 assert.deepEqual(readAccountMapping([entity],key),mapping);
 const patch=rememberAccountMappingCommand([entity],key,{...mapping,accountId:'wallet-2'});assert.equal(patch.action,'PATCH_FIELD');assert.equal(patch.entity.id,create.entity.id);
});

test('existing typed memory suppresses duplicate legacy migration command',()=>{
 const key={sourceSystem:'ALIPAY',profile:'本人',channelKey:'支付宝:余额',role:'PRIMARY'},mapping={accountId:'wallet',rememberedAt:'2026-10-01T00:00:00Z'};
 const typed=rememberAccountMappingCommand([],key,mapping).entity as Entity;
 const entities=[account('wallet','支付宝余额'),typed,rule('legacy',{v:1,platform:'支付宝',profile:'本人',channel:'余额',role:'付款账户',accountId:'wallet'})];
 assert.deepEqual(legacyAccountMemoryMigrationCommands(entities,'2026-10-02T06:00:00Z'),[]);
});
