import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {cloudAuthError,cloudIdentityFrom} from '../apps/web/src/cloud-auth-result.ts';
const require=createRequire(import.meta.url);
const {register,digest,invitesFrom}=require('../cloudbase/functions/star-ledger-register/policy.cjs');
const token='t'.repeat(43),now=Date.parse('2026-10-05T00:00:00Z');
function fixture(){
 const claims=new Map(),users:any[]=[];
 const deps={now,invites:invitesFrom(JSON.stringify([{username:'alice',digest:digest(token),expiresAt:'2026-10-06T00:00:00Z'}])),repository:{async claim(row:any){if(claims.has(row.id))return false;claims.set(row.id,structuredClone(row));return true;}},async createUser(user:any){users.push(user);}};
 return {deps,claims,users,input:{username:'alice',password:'Test@12345',invitation:token}};
}
test('invitation is required, matches its username, and expires before any provider call',async()=>{
 for(const change of [{invitation:'bad'},{invitation:'s'.repeat(43)},{username:'other-user'}]){
  const f=fixture();assert.equal((await register({...f.input,...change},f.deps)).code,'INVITATION_INVALID');assert.equal(f.claims.size,0);assert.equal(f.users.length,0);
 }
 const f=fixture();f.deps.now=Date.parse('2026-10-06T00:00:00Z');assert.equal((await register(f.input,f.deps)).code,'INVITATION_INVALID');assert.equal(f.users.length,0);
});
test('closed or invalid invitation configuration fails closed',async()=>{
 for(const value of [undefined,'{}','[]','not-json',JSON.stringify([{username:'alice',digest:'bad',expiresAt:'invalid'}])])assert.deepEqual(invitesFrom(value),[]);
 const f=fixture();f.deps.invites=[];assert.equal((await register(f.input,f.deps)).code,'REGISTRATION_CLOSED');assert.equal(f.users.length,0);
});
test('invalid passwords and usernames never consume an invitation',async()=>{
 for(const change of [{password:'short'},{password:'123456789'},{password:'Test@ 12345'},{password:'!Test12345'},{password:'密码Ab12345'},{username:'../admin'},{username:'a'}]){
  const f=fixture();assert.equal((await register({...f.input,...change},f.deps)).code,'REGISTRATION_INPUT_INVALID');assert.equal(f.claims.size,0);
 }
});
test('HTTP registration rejects wrong origins, methods, oversized or malformed bodies before touching user creation',async()=>{
 const {createHandler}=require('../cloudbase/functions/star-ledger-register/http.cjs');let calls=0;
 const origin='https://example.test',handler=createHandler({origin,register:async()=>{calls++;return {ok:true};}});
 const event={httpMethod:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(fixture().input)};
 for(const changed of [{httpMethod:'GET'},{headers:{Origin:'https://other.test','Content-Type':'application/json'}},{body:'{'},{body:'x'.repeat(2049)},{isBase64Encoded:true}]){
  assert.ok((await handler({...event,...changed})).statusCode>=400);
 }
 assert.equal(calls,0);const response=await handler(event);assert.equal(response.statusCode,201);assert.equal(response.headers['Cache-Control'],'no-store');assert.deepEqual(JSON.parse(response.body),{ok:true});assert.equal(calls,1);
});
test('two concurrent requests create exactly one ordinary user without persisting password or token',async()=>{
 const f=fixture(),results=await Promise.all([register({...f.input,role:'admin',uid:'attacker'},f.deps),register(f.input,f.deps)]);
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.filter(r=>r.code==='INVITATION_USED').length,1);assert.equal(f.users.length,1);
 const user=f.users[0];assert.equal(user.type,'externalUser');assert.equal(user.userStatus,'ACTIVE');assert.match(user.uid,/^sl[a-f0-9]{62}$/);assert.equal('role' in user,false);
 const stored=JSON.stringify([...f.claims.values()]);assert.equal(stored.includes(f.input.password),false);assert.equal(stored.includes(token),false);
 assert.equal((await register(f.input,f.deps)).code,'INVITATION_USED');assert.equal(f.users.length,1);
});
test('storage failure blocks identity creation; uncertain provider result never reopens invitation or changes an account password',async()=>{
 const f=fixture();f.deps.repository.claim=async()=>{throw Error('database unavailable');};assert.equal((await register(f.input,f.deps)).code,'REGISTRATION_UNAVAILABLE');assert.equal(f.users.length,0);
 const g=fixture();g.deps.createUser=async()=>{throw Error(g.input.password);};assert.deepEqual(await register(g.input,g.deps),{ok:false,code:'REGISTRATION_RESULT_UNKNOWN'});
 assert.equal((await register(g.input,g.deps)).code,'INVITATION_USED');assert.equal(g.claims.size,1);
});
test('authentication distinguishes explicit credential rejection from generic provider failure without exposing descriptions',()=>{
 assert.equal(cloudAuthError({code:'invalid_credentials'}).message,'CLOUDBASE_CREDENTIALS_INVALID');
 assert.equal(cloudAuthError({code:'unexpected',message:'private details',error_description:'password'}).message,'CLOUDBASE_AUTH_FAILED');
 assert.equal(cloudAuthError({status:429}).message,'CLOUDBASE_AUTH_RATE_LIMITED');
 assert.throws(()=>cloudIdentityFrom({error:{code:'invalid_credentials'}}),/CLOUDBASE_CREDENTIALS_INVALID/);
 assert.deepEqual(cloudIdentityFrom({data:{user:{id:'uid-1',user_metadata:{username:'alice'}}}}),{uid:'uid-1',username:'alice'});
 assert.equal(cloudIdentityFrom({data:{session:null}}),null);assert.deepEqual(cloudIdentityFrom({data:{session:{user:{id:'uid-2'}}}},'alice'),{uid:'uid-2',username:'alice'});
});
