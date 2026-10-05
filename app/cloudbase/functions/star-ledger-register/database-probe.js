// Console-only diagnostic for R14/C05/C06/M6. No writes and no returned records.
const knownCodes=new Set(['DATABASE_COLLECTION_NOT_EXIST','COLLECTION_NOT_EXIST','DATABASE_NOT_EXIST','ENV_NOT_EXIST','INVALID_ENV','PERMISSION_DENIED','AUTH_FAILED','INVALID_PARAM','TIMEOUT','NETWORK_ERROR']);
function safeCode(error){
 const value=error?.code;
 if(typeof value==='number'&&Number.isSafeInteger(value))return value;
 if(typeof value==='string'&&(knownCodes.has(value)||/^-?\d{1,9}$/.test(value)))return value;
 return 'PROBE_FAILED';
}
function createProbe(getDatabase){
 return async event=>{
  if(!event||event.httpMethod||event.headers||!['document-readonly','transaction-readonly'].includes(event.mode))return {ok:false,code:'CONSOLE_PROBE_ONLY'};
  const stage=event.mode,started=Date.now();
  try{
   const db=getDatabase();
   const read=async source=>{await source.collection('star_ledger_registration').doc('star-ledger-readonly-probe').get();};
   if(stage==='document-readonly')await read(db);
   else await db.runTransaction(async tx=>{await read(tx);});
   return {ok:true,stage,elapsedMs:Date.now()-started};
  }catch(error){return {ok:false,stage,code:safeCode(error),elapsedMs:Date.now()-started};}
 };
}
exports.createProbe=createProbe;
exports.main=createProbe(()=>require('@cloudbase/js-sdk').init({env:'xingzhang-dev-d0g4a950c6f1204d1',region:'ap-shanghai',timeout:1800}).database());
