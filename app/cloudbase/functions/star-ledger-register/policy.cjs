const {createHash,timingSafeEqual}=require('node:crypto');
const digest=value=>createHash('sha256').update(value).digest('hex');
const usernamePattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{4,23}$/;
function validPassword(password){return typeof password==='string'&&/^[A-Za-z0-9][A-Za-z0-9()!@#$%^&*|?><_-]{7,31}$/.test(password)&&[/[A-Z]/,/[a-z]/,/[0-9]/,/[()!@#$%^&*|?><_-]/].filter(rule=>rule.test(password)).length>=3;}
function invitesFrom(value){
 try{const rows=JSON.parse(value);if(!Array.isArray(rows)||!rows.length||rows.length>100)return [];
  if(rows.some(row=>!row||!usernamePattern.test(row.username)||!/^[a-f0-9]{64}$/.test(row.digest)||!Number.isFinite(Date.parse(row.expiresAt))))return [];
  if(new Set(rows.map(row=>row.digest)).size!==rows.length||new Set(rows.map(row=>row.username)).size!==rows.length)return [];
  return rows;
 }catch{return [];}
}
/** Only consumes a durable invitation before calling the trusted identity provider.
 * An uncertain provider result never releases it or replaces an existing password. */
async function register(input,{invites,repository,createUser,now=Date.now()}){
 if(!invites.length)return {ok:false,code:'REGISTRATION_CLOSED'};
 if(!input||typeof input!=='object'||!usernamePattern.test(input.username)||!validPassword(input.password))return {ok:false,code:'REGISTRATION_INPUT_INVALID'};
 if(typeof input.invitation!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(input.invitation))return {ok:false,code:'INVITATION_INVALID'};
 const tokenDigest=digest(input.invitation);
 const invitation=invites.find(row=>timingSafeEqual(Buffer.from(row.digest,'hex'),Buffer.from(tokenDigest,'hex')));
 if(!invitation||invitation.username!==input.username||Date.parse(invitation.expiresAt)<=now)return {ok:false,code:'INVITATION_INVALID'};
 const uid='sl'+digest('star-ledger:user:'+input.username).slice(0,62);
 try{if(!await repository.claim({id:tokenDigest,username:input.username,uid,claimedAt:new Date(now).toISOString()}))return {ok:false,code:'INVITATION_USED'};}
 catch{return {ok:false,code:'REGISTRATION_UNAVAILABLE'};}
 try{
  await createUser({name:input.username,password:input.password,uid,type:'externalUser',userStatus:'ACTIVE'});
  return {ok:true};
 }catch{return {ok:false,code:'REGISTRATION_RESULT_UNKNOWN'};}
}
module.exports={digest,invitesFrom,register,validPassword};
