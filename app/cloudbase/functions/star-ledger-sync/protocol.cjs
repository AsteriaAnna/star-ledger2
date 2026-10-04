const {createHash}=require('node:crypto');
const digest=value=>createHash('sha256').update(value).digest('hex');
const ledgerFor=uid=>'cloud-'+digest(uid).slice(0,32);
const prefixFor=uid=>digest(uid).slice(0,32)+':';
const error=code=>{throw Error(code);};
/** UID comes only from the CloudBase runtime, never from event.uid/owner. */
async function handleRequest(event,uid,repo){
 if(typeof uid!=='string'||!uid)error('CLOUD_AUTH_REQUIRED');
 const ledger=ledgerFor(uid),prefix=prefixFor(uid);
 if(event?.ledger!==ledger)error('CLOUD_OWNER_MISMATCH');
 const requirePath=path=>{
  if(typeof path!=='string'||!new RegExp('^ledger-sync/'+ledger+'/[\\w-]+/\\d{16}\\.json$').test(path))error('INVALID_REMOTE_PATH');
  return prefix+digest(path).slice(0,32);
 };
 const owned=row=>{if(row&&row.owner!==uid)error('CLOUD_OWNER_MISMATCH');return row;};
 switch(event.action){
  case 'HEALTH':return {uid,ledger};
  case 'LIST':{
   if(event.cursor!==undefined&&(typeof event.cursor!=='string'||!event.cursor.startsWith(prefix)))error('INVALID_CURSOR');
   const rows=await repo.list(prefix,event.cursor,100);rows.forEach(owned);
   return {files:rows.filter(r=>r.kind==='BATCH').map(r=>({path:r.path,sha:r.digest})),nextCursor:rows.length===100?rows[rows.length-1]._id:null};
  }
  case 'GET':{
   const row=owned(await repo.get(requirePath(event.path)));if(!row||row.kind!=='BATCH')error('REMOTE_FILE_MISSING');
   if(event.sha!==row.digest||digest(row.content)!==row.digest)error('REMOTE_FILE_CHANGED');return {content:row.content};
  }
  case 'PUT':{
   const id=requirePath(event.path);
   if(typeof event.content!=='string'||Buffer.byteLength(event.content)>512*1024)error('ENVELOPE_TOO_LARGE');
   let envelope;try{envelope=JSON.parse(event.content);}catch{error('INVALID_ENVELOPE');}
   if(envelope.format!==1||envelope.protocol!==2||envelope.ledger!==ledger||!Number.isSafeInteger(envelope.seq)||envelope.seq<1||event.path!==`ledger-sync/${ledger}/${envelope.device}/${String(envelope.seq).padStart(16,'0')}.json`)error('INVALID_ENVELOPE');
   const row={_id:id,owner:uid,kind:'BATCH',path:event.path,digest:digest(event.content),content:event.content};
   await repo.insertImmutable(row);return {sha:row.digest};
  }
  case 'GET_KEY':{const row=owned(await repo.get(prefix+'key'));return {wrappedKey:row?.content??null};}
  case 'PUT_KEY':{
   if(typeof event.wrappedKey!=='string'||Buffer.byteLength(event.wrappedKey)>8192)error('INVALID_WRAPPED_KEY');
   await repo.insertImmutable({_id:prefix+'key',owner:uid,kind:'KEY',content:event.wrappedKey,digest:digest(event.wrappedKey)});return {saved:true};
  }
  case 'REPLACE_KEY':{
   if(typeof event.expectedWrappedKey!=='string'||typeof event.wrappedKey!=='string'||Buffer.byteLength(event.expectedWrappedKey)>8192||Buffer.byteLength(event.wrappedKey)>8192)error('INVALID_WRAPPED_KEY');
   await repo.replaceKey({_id:prefix+'key',owner:uid,kind:'KEY',content:event.wrappedKey,digest:digest(event.wrappedKey)},event.expectedWrappedKey);return {saved:true};
  }
  default:error('INVALID_CLOUD_ACTION');
 }
}
module.exports={handleRequest,ledgerFor,prefixFor,digest};
