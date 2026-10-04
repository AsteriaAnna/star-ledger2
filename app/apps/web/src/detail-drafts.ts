import {detailFieldNames,type DetailFields} from '../../../packages/application/transaction-edit.ts';
export type DetailDraft={version:1;device:string;transactionId:string;expectedSnapshot:string;base:DetailFields;values:DetailFields;updatedAt:string};
export type DraftStorage=Pick<Storage,'getItem'|'setItem'|'removeItem'|'key'|'length'>;
const prefix=(device:string)=>`star-detail-draft:v1:${encodeURIComponent(device)}:`;
export const draftKey=(device:string,tab:string,id:string)=>prefix(device)+encodeURIComponent(tab)+':'+encodeURIComponent(id);
export function changedDetailFields(base:DetailFields,values:DetailFields):Partial<DetailFields>{
 const result:Partial<DetailFields>={};for(const key of detailFieldNames)if(base[key]!==values[key])result[key]=values[key] as any;
 return result;
}
const fieldsValid=(v:any):v is DetailFields=>v&&typeof v.name==='string'&&typeof v.note==='string'&&(v.category===null||typeof v.category==='string')&&detailFieldNames.every(k=>v[k]===undefined||v[k]===null||typeof v[k]==='string');
export function readDetailDraft(storage:DraftStorage,key:string,device:string):DetailDraft|null{
 if(!key.startsWith(prefix(device)))return null;
 const raw=storage.getItem(key);if(!raw)return null;
 try{const v=JSON.parse(raw);return v?.version===1&&v.device===device&&typeof v.transactionId==='string'&&typeof v.expectedSnapshot==='string'&&typeof v.updatedAt==='string'&&fieldsValid(v.base)&&fieldsValid(v.values)?v:null;}catch{return null;}
}
export function listDetailDrafts(storage:DraftStorage,device:string){
 const result:{key:string;draft:DetailDraft}[]=[];
 for(let i=0;i<storage.length;i++){const key=storage.key(i);if(!key)continue;const draft=readDetailDraft(storage,key,device);if(draft)result.push({key,draft});}
 return result.sort((a,b)=>b.draft.updatedAt.localeCompare(a.draft.updatedAt));
}
export function writeDetailDraft(storage:DraftStorage,key:string,draft:DetailDraft){
 if(!key.startsWith(prefix(draft.device)))throw Error('INVALID_DETAIL_DRAFT');
 if(Object.keys(changedDetailFields(draft.base,draft.values)).length)storage.setItem(key,JSON.stringify(draft));else storage.removeItem(key);
}
