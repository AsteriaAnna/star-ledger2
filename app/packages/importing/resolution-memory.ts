import type {Entity} from '../domain/index.ts';
import type {AccountIdentity,AccountMapping,CategoryMapping,MerchantIdentity} from '../application/ports.ts';
import type {Command} from '../accounting/index.ts';
import {channelKey as normalizeChannelKey,describeFundingChannel} from './channel.ts';

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
export const rememberAccountMappingCommand=(entities:Entity[],key:AccountIdentity,mapping:AccountMapping)=>mappingCommand(entities,accountMappingKey(key),{...mapping,identity:key});
export const rememberMerchantCategoryCommand=(entities:Entity[],key:MerchantIdentity,mapping:CategoryMapping)=>mappingCommand(entities,merchantCategoryKey(key),mapping);


export type LegacyAccountMemoryMigration={key:AccountIdentity;mapping:AccountMapping;legacyRuleIds:string[]};

export function legacyAccountMemoryMigrations(entities:Entity[],migratedAt:string):LegacyAccountMemoryMigration[]{
 const grouped=new Map<string,{key:AccountIdentity;accountIds:Set<string>;legacyRuleIds:string[]}>();
 for(const entity of entities){
  if(entity.type!=='import_rules'||!entity.fields.value||String(entity.fields.rule_key||'').startsWith('v2-account:'))continue;
  let value:any;try{value=JSON.parse(String(entity.fields.value));}catch{continue;}
  if(value?.v!==1||typeof value.platform!=='string'||typeof value.profile!=='string'||typeof value.channel!=='string'||typeof value.accountId!=='string')continue;
  // Only legacy payer/destination aliases are semantically safe to collapse into PRIMARY.
  // Old target aliases mixed repayment and transfer semantics, so they must be confirmed again.
  if(!['付款账户','到账账户'].includes(String(value.role)))continue;
  const sourceSystem=value.platform==='微信'?'WECHAT':value.platform==='支付宝'?'ALIPAY':'UNKNOWN';
  const descriptor=describeFundingChannel(value.platform,value.channel);
  const key:AccountIdentity={sourceSystem,profile:value.profile,channelKey:descriptor?.identity||normalizeChannelKey(value.channel),role:'PRIMARY'};
  const id=accountMappingKey(key),current=grouped.get(id)??{key,accountIds:new Set<string>(),legacyRuleIds:[]};
  current.accountIds.add(value.accountId);current.legacyRuleIds.push(entity.id);grouped.set(id,current);
 }
 const out:LegacyAccountMemoryMigration[]=[];
 for(const value of grouped.values()){
  if(value.accountIds.size!==1)continue;
  const accountId=[...value.accountIds][0];
  if(!entities.some(entity=>entity.type==='accounts'&&entity.id===accountId&&!entity.fields.deleted_at))continue;
  out.push({key:value.key,mapping:{accountId,rememberedAt:migratedAt},legacyRuleIds:value.legacyRuleIds});
 }
 return out;
}

export function legacyAccountMemoryMigrationCommands(entities:Entity[],migratedAt:string):Command[]{
 return legacyAccountMemoryMigrations(entities,migratedAt)
  .filter(value=>!readAccountMapping(entities,value.key))
  .map(value=>rememberAccountMappingCommand(entities,value.key,value.mapping));
}
