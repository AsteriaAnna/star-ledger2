import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
export const importIdentityHash=(value:unknown)=>bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
/** Existing v2 Excel identity byte-for-byte: a refund's original order is never its own key. */
export function strongSourceEventIdentity(platform:string,profile:string,sourceClass:'payment'|'refund',eventId:string){
 return importIdentityHash({v:2,platform,profile,sourceClass,eventId});
}
