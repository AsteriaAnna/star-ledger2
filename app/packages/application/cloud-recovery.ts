import {wrapRecoveryKey,verifyRecoveryKey} from '../platform/password-key.ts';
import {webSessionCrypto} from '../platform/web-crypto.ts';
import type {CloudBaseSyncProvider} from '../sync/cloudbase.ts';

export type CloudRecovery={format:'star-ledger-cloud-recovery';version:1;uid:string;ledger:string;recoveryKey:string};
export function parseCloudRecovery(text:string,uid:string,ledger:string):CloudRecovery{
 let value:CloudRecovery;try{value=JSON.parse(text);}catch{throw Error('INVALID_RECOVERY_FILE');}
 if(!value||value.format!=='star-ledger-cloud-recovery'||value.version!==1||!/^[A-Za-z0-9_-]{43}$/.test(value.recoveryKey))throw Error('INVALID_RECOVERY_FILE');
 if(value.uid!==uid||value.ledger!==ledger)throw Error('CLOUD_OWNER_MISMATCH');
 return value;
}
/** Prove the original key, then rewrap that same key. No ledger batches are replaced. */
export async function recoverCloudKey(remote:CloudBaseSyncProvider,uid:string,ledger:string,key:string,password:string,knownLocalKey?:string){
 if(!/^[A-Za-z0-9_-]{43}$/.test(key)||!password)throw Error('INVALID_RECOVERY_FILE');
 await remote.healthCheck();
 const previous=await remote.getWrappedKey();if(!previous)throw Error('CLOUD_KEY_MISSING');
 const proof=await verifyRecoveryKey(previous,key,uid,ledger);
 if(proof===false)throw Error('CLOUD_KEY_UNLOCK_FAILED');
 if(proof===null&&knownLocalKey!==key){
  const [file]=await remote.list();if(!file)throw Error('CLOUD_KEY_UNVERIFIABLE');
  try{await(await webSessionCrypto(ledger,key)).open(await remote.download(file));}catch{throw Error('CLOUD_KEY_UNLOCK_FAILED');}
 }
 const wrapped=await wrapRecoveryKey(key,password,uid,ledger);
 await remote.replaceWrappedKey(previous,wrapped);
 return key;
}
