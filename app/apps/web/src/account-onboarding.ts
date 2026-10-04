import {cloudbaseSignIn,rememberCloudIdentity,type CloudIdentity} from './cloudbase.ts';
import {prepareCloudLedger,synchronizeCloud} from './cloud-sync.ts';
import {selectLocalLedger} from './store.ts';
const registrationCodes=new Set(['REGISTRATION_CLOSED','REGISTRATION_INPUT_INVALID','INVITATION_INVALID','INVITATION_USED','REGISTRATION_UNAVAILABLE','REGISTRATION_RESULT_UNKNOWN']);
export async function registerCloudAccount(username:string,password:string,invitation:string){
 let response:Response;
 try{response=await fetch('./api/account/register',{method:'POST',headers:{'Content-Type':'application/json'},cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10000),body:JSON.stringify({username:username.trim(),password,invitation:invitation.trim()})});}
 catch{throw Error('REGISTRATION_RESULT_UNKNOWN');}
 let result:any;try{result=await response.json();}catch{throw Error('REGISTRATION_UNAVAILABLE');}
 if(!response.ok||result?.ok!==true)throw Error(registrationCodes.has(result?.code)?result.code:'REGISTRATION_UNAVAILABLE');
}
/** Authentication success and ledger connection are distinct results. */
export async function signInCloudAccount(username:string,password:string):Promise<{identity:CloudIdentity;syncError?:Error}>{
 const identity=await cloudbaseSignIn(username,password);
 await selectLocalLedger(identity.uid);rememberCloudIdentity(identity);
 try{await prepareCloudLedger(identity,password);await synchronizeCloud();return {identity};}
 catch(error){return {identity,syncError:error instanceof Error?error:Error('CLOUDBASE_SYNC_UNAVAILABLE')};}
}
