'use strict';
exports.main=async event=>{
 const nodeSdk=require('@cloudbase/node-sdk');const Manager=require('@cloudbase/manager-node');
 const env='xingzhang-dev-d0g4a950c6f1204d1';
 const app=nodeSdk.init({env});const manager=Manager.init({envId:env,region:'ap-shanghai'});
 const {CapturePostgresRepository}=require('./postgres.cjs');const {createHandler}=require('./handler.cjs');
 const handler=createHandler({repo:new CapturePostgresRepository(sql=>manager.database.executePGSql(sql)),shared:require('./shared.cjs'),getUid:async()=>(await app.auth().getEndUserInfo()).userInfo?.uid,key:process.env.TOKENHUB_API_KEY,allowedUids:new Set((process.env.CAPTURE_ALLOWED_UIDS||'').split(',').map(x=>x.trim()).filter(Boolean)),log:entry=>console.log(JSON.stringify(entry))});
 return handler(event);
};
