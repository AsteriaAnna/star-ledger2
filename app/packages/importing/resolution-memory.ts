import type {Entity} from '../domain/index.ts';
import type {AccountIdentity,AccountMapping,CategoryMapping,MerchantIdentity} from '../application/ports.ts';

const stable=(value:Record<string,string>)=>JSON.stringify(Object.keys(value).sort().map(k=>[k,value[k]]));
const encode=(value:string)=>encodeURIComponent(value).replace(/%/g,'_');
export const accountMappingKey=(key:AccountIdentity)=>'v2-account:'+encode(stable(key));
export const merchantCategoryKey=(key:MerchantIdentity)=>'v2-category:'+encode(stable(key));

const value=(entities:Entity[],id:string)=>{
 const entity=entities.find(e=>e.type==='import_rules'&&e.id===id);
 if(!entity?.fields.value)return null;
 try{return JSON.parse(String(entity.fields.value));}catch{return null;}
};

export function readAccountMapping(entities:Entity[],key:AccountIdentity):AccountMapping|null{
 const v=value(entities,accountMappingKey(key));
 return v&&typeof v.accountId==='string'&&typeof v.rememberedAt==='string'?v:null;
}
export function readMerchantCategory(entities:Entity[],key:MerchantIdentity):CategoryMapping|null{
 const v=value(entities,merchantCategoryKey(key));
 return v&&typeof v.categoryId==='string'&&typeof v.rememberedAt==='string'?v:null;
}
