const CloudBase=require('@cloudbase/manager-node');
const cloudbase=require('@cloudbase/js-sdk');
const {invitesFrom,register}=require('./policy.cjs');
const {createHandler}=require('./http.cjs');
const env='xingzhang-dev-d0g4a950c6f1204d1';
const manager=CloudBase.init({envId:env,region:'ap-shanghai',timeout:2200});
const db=cloudbase.init({env,region:'ap-shanghai'}).database();
const origin='https://xingzhang-dev-d0g4a950c6f1204d1-1428502724.tcloudbaseapp.com';
const repository={async claim(row){
 return db.runTransaction(async tx=>{
  const doc=tx.collection('star_ledger_registration').doc(row.id),result=await doc.get();
  if(Array.isArray(result.data)?result.data.length:!!result.data)return false;
  const {id,...data}=row;await doc.set(data);return true;
 });
}};
// Ordinary event function exposed through one HTTPS route. Never log event/body/password.
exports.main=createHandler({origin,register:input=>register(input,{invites:invitesFrom(process.env.STAR_LEDGER_INVITES_JSON),repository,createUser:user=>manager.user.createUser(user)})});
