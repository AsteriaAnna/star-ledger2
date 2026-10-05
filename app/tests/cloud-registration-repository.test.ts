import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createRepository, claimSql, claimedFrom} = require('../cloudbase/functions/star-ledger-register/registration-repository.cjs');
const {register, digest} = require('../cloudbase/functions/star-ledger-register/policy.cjs');
const row = {id:'a'.repeat(64), username:'alice', uid:'sl'+'b'.repeat(62)};
test('SQL rejects injection at every interpolated field', () => {
  for (const key of ['id','username','uid']) {
    assert.throws(() => claimSql({...row,[key]:"x'); DELETE FROM auth.users; --"}));
  }
  const sql = claimSql(row);
  assert.match(sql,/ON CONFLICT DO NOTHING/);
  assert.equal(sql.includes('UPDATE'),false);
  assert.equal(sql.includes('password'),false);
});
test('only the exact documented affected-row winner can create a user', async () => {
  assert.equal(claimedFrom({AffectedRows:1,Columns:null,Rows:null}),true);
  assert.equal(claimedFrom({AffectedRows:0,Columns:null,Rows:null}),false);
  for(const result of [{}, {AffectedRows:'1'}, {AffectedRows:2}, {AffectedRows:-1},
    {AffectedRows:null}, {Columns:['claimed'],Rows:['["1"]']}]) {
    assert.throws(()=>claimedFrom(result));
  }
  let request:any;
  const repository=createRepository({async executePGSql(input:any) {
    request=input; return {AffectedRows:1};
  }});
  assert.equal(await repository.claim(row),true);
  assert.equal(request.Role,'service_role');
});
test('storage rejection, ambiguous response and losing claim never call identity provider', async () => {
  const token='t'.repeat(43);
  for(const database of [
    {async executePGSql(){throw Error('private credential');}},
    {async executePGSql(){return {}; }},
    {async executePGSql(){return {AffectedRows:0};}}
  ]){
    let users=0;
    const result=await register({username:'alice',password:'Test@12345',invitation:token},{
      invites:[{username:'alice',digest:digest(token),expiresAt:'2099-01-01T00:00:00Z'}],
      repository:createRepository(database),createUser:async()=>{users++;}
    });
    assert.equal(users,0); assert.equal(result.ok,false);
    assert.ok(['REGISTRATION_UNAVAILABLE','INVITATION_USED'].includes(result.code));
  }
});
