import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createProbe}=createRequire(import.meta.url)('../cloudbase/functions/star-ledger-register/database-probe.js');
test('database probe rejects HTTP and unsupported events before initializing database',async()=>{
 let calls=0;const probe=createProbe(()=>{calls++;throw Error('must not connect');});
 for(const event of [null,{}, {mode:'write'}, {mode:'document-readonly',httpMethod:'POST'}, {mode:'document-readonly',headers:{}}])assert.equal((await probe(event)).code,'CONSOLE_PROBE_ONLY');
 assert.equal(calls,0);
});
test('both probe stages only read the reserved document and never return its contents',async()=>{
 const reads:string[]=[];let transactions=0;
 const source={collection(name:string){assert.equal(name,'star_ledger_registration');return {doc(id:string){assert.equal(id,'star-ledger-readonly-probe');return {async get(){reads.push(id);return {data:[{password:'private',uid:'secret',bill:999}]};}};}};}};
 const probe=createProbe(()=>({...source,async runTransaction(callback:any){transactions++;return callback(source);}}));
 for(const mode of ['document-readonly','transaction-readonly']){const result=await probe({mode});assert.equal(result.ok,true);assert.equal(result.stage,mode);assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal('data' in result,false);}
 assert.equal(reads.length,2);assert.equal(transactions,1);
});
test('probe failures expose bounded diagnostic codes without exception descriptions',async()=>{
 for(const [code,expected] of [['secret-password','PROBE_FAILED'],['PERMISSION_DENIED','PERMISSION_DENIED'],[-502005,-502005]]){
  const probe=createProbe(()=>{throw Object.assign(Error('private token and password'),{code});});
  const result=await probe({mode:'document-readonly'});assert.equal(result.ok,false);assert.equal(result.code,expected);assert.equal(JSON.stringify(result).includes('private'),false);
 }
});

test('probe recognizes database SDK errCode without exposing errMsg',async()=>{
 const probe=createProbe(()=>{throw {errCode:'DATABASE_REQUEST_FAILED',errMsg:'private password',code:'other'};});
 const result=await probe({mode:'document-readonly'});assert.equal(result.code,'DATABASE_REQUEST_FAILED');assert.equal(JSON.stringify(result).includes('private'),false);
});
