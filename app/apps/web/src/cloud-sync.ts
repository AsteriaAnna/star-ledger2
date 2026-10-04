import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import {CloudBaseSyncProvider} from '../../../packages/sync/cloudbase.ts';
import {createRecoveryKey,wrapRecoveryKey,unwrapRecoveryKey} from '../../../packages/platform/password-key.ts';
import {cloudbaseClient,cloudbaseSession,cloudbaseConfig,localCloudIdentity,type CloudIdentity} from './cloudbase.ts';
import {selectLocalLedger,mutate,read,synchronizeEncrypted} from './store.ts';
const ledgerFor=(uid:string)=>'cloud-'+bytesToHex(sha256(new TextEncoder().encode(uid))).slice(0,32);
async function provider(identity:CloudIdentity){
 const session=await cloudbaseSession();if(session?.uid!==identity.uid)throw Error('CLOUD_OWNER_MISMATCH');
 const client=await cloudbaseClient();
 return new CloudBaseSyncProvider(async data=>{
  if((await cloudbaseSession())?.uid!==identity.uid)throw Error('CLOUD_OWNER_MISMATCH');
  try{const response=await client.callFunction({name:'star-ledger-sync',data});if(!response.result||typeof response.result!=='object')throw Error('INVALID_CLOUD_RESPONSE');return response.result;}
  catch(error){if(error instanceof Error&&['CLOUD_OWNER_MISMATCH','REMOTE_COLLISION'].includes(error.message))throw error;throw Error('CLOUDBASE_SYNC_UNAVAILABLE');}
 },identity.uid,ledgerFor(identity.uid));
}
/** Cloud holds only a password-wrapped key; passwords are never persisted by the ledger. */
export async function prepareCloudLedger(identity:CloudIdentity,password:string){
 const remote=await provider(identity);await remote.healthCheck();let wrapped=await remote.getWrappedKey(),key:string;
 if(wrapped)key=await unwrapRecoveryKey(wrapped,password,identity.uid,ledgerFor(identity.uid));
 else{
  key=createRecoveryKey();wrapped=await wrapRecoveryKey(key,password,identity.uid,ledgerFor(identity.uid));
  try{await remote.putWrappedKey(wrapped);}catch(error){const stored=await remote.getWrappedKey();if(!stored)throw error;key=await unwrapRecoveryKey(stored,password,identity.uid,ledgerFor(identity.uid));}
 }
 await selectLocalLedger(identity.uid);
 await mutate(store=>{if(store.state.cloud&&store.state.cloud.recoveryKey!==key)throw Error('CLOUD_KEY_UNLOCK_FAILED');store.state.cloud={uid:identity.uid,ledger:ledgerFor(identity.uid),recoveryKey:key};});
}
let running:Promise<void>|undefined;
export function synchronizeCloud(progress:(message:string)=>void=()=>{}){
 if(running)return running;
 running=(async()=>{const identity=localCloudIdentity(),state=await read();if(!identity||state.cloud?.uid!==identity.uid)throw Error('CLOUD_SIGNIN_REQUIRED');const remote=await provider(identity);await synchronizeEncrypted({provider:remote,uid:identity.uid,ledger:state.cloud.ledger,key:state.cloud.recoveryKey,target:`cloudbase:${cloudbaseConfig.env}:${identity.uid}`},progress);})().finally(()=>{running=undefined;});return running;
}
/** Local saves trigger upload; reconnect/focus/poll also retrieve other-device changes. */
export function startCloudSync(onStatus:(status:string)=>void){
 let timer:ReturnType<typeof setTimeout>|undefined;
 const run=async(onlyPending=false)=>{const state=await read();if(!navigator.onLine||!state.cloud||!localCloudIdentity()||(onlyPending&&!state.pending.length))return;try{onStatus('正在同步');await synchronizeCloud();onStatus('已同步');}catch{onStatus('同步未完成，账单已保存在本机');}};
 window.addEventListener('ledger-saved',()=>{clearTimeout(timer);timer=setTimeout(()=>{void run(true);},1500);});
 window.addEventListener('online',()=>{void run();});window.addEventListener('focus',()=>{void run();});
 setInterval(()=>{if(document.visibilityState==='visible')void run();},60000);void run();
}
