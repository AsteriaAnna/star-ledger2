import {cloudIdentityFrom,cloudAuthError} from './cloud-auth-result.ts';
// Public client configuration. No cloud administrator credentials belong here.
export const cloudbaseConfig={env:'xingzhang-dev-d0g4a950c6f1204d1',region:'ap-shanghai'} as const;
export type CloudIdentity={uid:string;username:string};
const identityKey='star-ledger:cloudbase-identity';
export function localCloudIdentity():CloudIdentity|null{
 const value=localStorage.getItem(identityKey);if(!value)return null;
 try{const v=JSON.parse(value);return typeof v.uid==='string'&&v.uid&&typeof v.username==='string'?v:null;}catch{return null;}
}
async function createClient(){const {default:cloudbase}=await import('@cloudbase/js-sdk');return cloudbase.init({...cloudbaseConfig,persistence:'local'});}
let instance:ReturnType<typeof createClient>|undefined;
export async function cloudbaseClient(){
 if(!instance)instance=createClient();
 return instance;
}
export async function cloudbaseSignIn(username:string,password:string){
 let result:any;try{const client=await cloudbaseClient();result=await client.auth().signInWithPassword({username:username.trim(),password});}catch(error){if((error as any)?.code||(error as any)?.error)throw cloudAuthError(error);throw Error('CLOUDBASE_NETWORK_ERROR');}
 const identity=cloudIdentityFrom(result,username.trim());if(!identity)throw Error('CLOUDBASE_AUTH_FAILED');return identity;
}
export async function cloudbaseSession(){return cloudIdentityFrom(await(await cloudbaseClient()).auth().getSession());}
export async function cloudbaseSignOut(){await(await cloudbaseClient()).auth().signOut();}
export function rememberCloudIdentity(identity:CloudIdentity|null){if(identity)localStorage.setItem(identityKey,JSON.stringify(identity));else localStorage.removeItem(identityKey);}
export const cloudIdentityStorageKey=identityKey;
