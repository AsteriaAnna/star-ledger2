const cloudbase=require('@cloudbase/js-sdk');
const {handleRequest}=require('./protocol.cjs');
const app=cloudbase.init({env:'xingzhang-dev-d0g4a950c6f1204d1',region:'ap-shanghai'});
const db=app.database(),collection='star_ledger_private';
const first=result=>Array.isArray(result.data)?result.data[0]??null:result.data??null;
const repo={
 async get(id){return first(await db.collection(collection).doc(id).get());},
 async list(prefix,cursor,limit){const _=db.command;return (await db.collection(collection).where({_id:_.gt(cursor||prefix).and(_.lt(prefix+'~'))}).orderBy('_id','asc').limit(limit).field({_id:true,owner:true,kind:true,path:true,digest:true}).get()).data;},
 async insertImmutable(row){
  await db.runTransaction(async tx=>{
   const doc=tx.collection(collection).doc(row._id),old=first(await doc.get());
   if(old){if(old.owner!==row.owner||old.kind!==row.kind||old.content!==row.content)throw Error('REMOTE_COLLISION');return;}
   const {_id,...data}=row;await doc.set(data);
  });
 },
 async replaceKey(row,expected){
  await db.runTransaction(async tx=>{
   const doc=tx.collection(collection).doc(row._id),old=first(await doc.get());
   if(!old||old.owner!==row.owner||old.kind!=='KEY')throw Error('CLOUD_OWNER_MISMATCH');
   if(old.content===row.content)return;
   if(old.content!==expected)throw Error('CLOUD_KEY_CHANGED');
   const {_id,...data}=row;await doc.set(data);
  });
 }
};
exports.main=async event=>{
 // Server-side auth context is injected by the event function runtime.
 const {uid}=app.auth.getUserInfo();
 return handleRequest(event,uid,repo);
};
