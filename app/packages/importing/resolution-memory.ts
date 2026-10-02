import type {Entity} from '../domain/index.ts';
import type {AccountIdentity,AccountMapping,CategoryMapping,MerchantIdentity} from '../application/ports.ts';
import type {Command} from '../accounting/index.ts';

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


function mappingCommand(entities:Entity[],id:string,payload:unknown):Command{
 const old=entities.find(e=>e.type==='import_rules'&&e.id===id);
 const value=JSON.stringify(payload);
 return old?{action:'PATCH_FIELD',entity:{type:'import_rules',id,fields:{value}}}:{action:'CREATE_ENTITY',entity:{type:'import_rules',id,fields:{rule_key:id,value}}};
}
export const rememberAccountMappingCommand=(entities:Entity[],key:AccountIdentity,mapping:AccountMapping)=>mappingCommand(entities,accountMappingKey(key),mapping);
export const rememberMerchantCategoryCommand=(entities:Entity[],key:MerchantIdentity,mapping:CategoryMapping)=>mappingCommand(entities,merchantCategoryKey(key),mapping);
