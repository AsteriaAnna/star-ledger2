import type {EncryptedProvider,RemoteFile} from './github.ts';
export type CloudFunctionCall=(data:Record<string,unknown>)=>Promise<any>;
/** Cloud function owns authorization; the client also checks its selected ledger identity. */
export class CloudBaseSyncProvider implements EncryptedProvider {
 private call:CloudFunctionCall;private uid:string;private ledger:string;
 constructor(call:CloudFunctionCall,uid:string,ledger:string){this.call=call;this.uid=uid;this.ledger=ledger;}
 private request(action:string,data:Record<string,unknown>={}){return this.call({action,ledger:this.ledger,...data});}
 async healthCheck(){const result=await this.request('HEALTH');if(result?.uid!==this.uid||result?.ledger!==this.ledger)throw Error('CLOUD_OWNER_MISMATCH');}
 async list():Promise<RemoteFile[]>{
  const files:RemoteFile[]=[],seen=new Set<string>();let cursor:string|undefined;
  do{const result=await this.request('LIST',cursor?{cursor}:{});if(!Array.isArray(result?.files))throw Error('INVALID_CLOUD_RESPONSE');
   for(const f of result.files){if(typeof f?.path!=='string'||!f.path.startsWith(`ledger-sync/${this.ledger}/`)||!/^[a-f0-9]{64}$/.test(f.sha)||seen.has(f.path))throw Error('INVALID_CLOUD_RESPONSE');seen.add(f.path);files.push(f);}
   if(result.nextCursor!==null&&typeof result.nextCursor!=='string')throw Error('INVALID_CLOUD_RESPONSE');if(result.nextCursor&&result.nextCursor===cursor)throw Error('INVALID_CLOUD_RESPONSE');cursor=result.nextCursor||undefined;
  }while(cursor);return files.sort((a,b)=>a.path.localeCompare(b.path));
 }
 async download(file:RemoteFile){const result=await this.request('GET',file);if(typeof result?.content!=='string')throw Error('INVALID_CLOUD_RESPONSE');return result.content;}
 async upload(path:string,content:string){await this.request('PUT',{path,content});}
 async getWrappedKey():Promise<string|null>{const result=await this.request('GET_KEY');if(result?.wrappedKey!==null&&typeof result?.wrappedKey!=='string')throw Error('INVALID_CLOUD_RESPONSE');return result.wrappedKey;}
 async putWrappedKey(wrappedKey:string){await this.request('PUT_KEY',{wrappedKey});}
 async replaceWrappedKey(expectedWrappedKey:string,wrappedKey:string){await this.request('REPLACE_KEY',{expectedWrappedKey,wrappedKey});}
}
