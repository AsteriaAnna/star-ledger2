import {base64,unbase64,utf8,text} from './bytes.ts';
export function createRecoveryKey(api:Crypto=globalThis.crypto){return base64(api.getRandomValues(new Uint8Array(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
type WrappedKey={version:1;uid:string;ledger:string;salt:string;nonce:string;ciphertext:string};
const aad=(uid:string,ledger:string)=>utf8(JSON.stringify({version:1,uid,ledger}));
async function passwordKey(password:string,salt:Uint8Array,api:Crypto){
 const material=await api.subtle.importKey('raw',utf8(password),'PBKDF2',false,['deriveKey']);
 return api.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function wrapRecoveryKey(key:string,password:string,uid:string,ledger:string,api:Crypto=globalThis.crypto){
 if(!/^[A-Za-z0-9_-]{43}$/.test(key)||!password||!uid||!ledger)throw Error('INVALID_CRYPTO_CONFIG');
 const salt=api.getRandomValues(new Uint8Array(16)),nonce=api.getRandomValues(new Uint8Array(12)),derived=await passwordKey(password,salt,api);
 const ciphertext=new Uint8Array(await api.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad(uid,ledger)},derived,utf8(key)));
 const value:WrappedKey={version:1,uid,ledger,salt:base64(salt),nonce:base64(nonce),ciphertext:base64(ciphertext)};return JSON.stringify(value);
}
export async function unwrapRecoveryKey(value:string,password:string,uid:string,ledger:string,api:Crypto=globalThis.crypto){
 let v:WrappedKey;try{v=JSON.parse(value);}catch{throw Error('INVALID_WRAPPED_KEY');}
 if(v.version!==1||v.uid!==uid||v.ledger!==ledger)throw Error('CLOUD_OWNER_MISMATCH');
 try{const salt=unbase64(v.salt,16),nonce=unbase64(v.nonce,12),key=await passwordKey(password,salt,api),decoded=await api.subtle.decrypt({name:'AES-GCM',iv:nonce,additionalData:aad(uid,ledger)},key,unbase64(v.ciphertext));const recovery=text(new Uint8Array(decoded));if(!/^[A-Za-z0-9_-]{43}$/.test(recovery))throw Error();return recovery;}catch{throw Error('CLOUD_KEY_UNLOCK_FAILED');}
}
