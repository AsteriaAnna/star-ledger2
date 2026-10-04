import type {Conflict,Entity} from '../domain/index.ts';
import {channelKey,describeFundingChannel,emptyChannel,needsSplitFunding} from './channel.ts';
import {accountMappingKey,readAccountMapping} from './resolution-memory.ts';

export type AccountRole='ACCOUNT'|'TARGET';
export type AccountResolutionRequest={
 eventKind:string;
 sourceSystem:string;
 platform:string;
 profile:string;
 channelRaw:string;
 role:AccountRole;
 sponsored:boolean;
 rememberedAccountId?:string|null;
};

export type AccountResolution={
 state:'RESOLVED'|'SUGGESTED'|'UNRESOLVED'|'NOT_APPLICABLE'|'CONFLICT'|'INVALID_MEMORY'|'SPLIT';
 accountId:string|null;
 candidates:string[];
 reason:string;
 memoryKey:{sourceSystem:string;profile:string;channelKey:string;role:string}|null;
};

const allowed=(request:AccountResolutionRequest,account:Entity)=>{
 if(account.type!=='accounts'||account.fields.deleted_at)return false;
 if(request.sponsored&&['PURCHASE','REFUND','RETURN'].includes(request.eventKind))return false;
 if(request.role==='TARGET'&&!['REPAYMENT','INTERNAL_TRANSFER','WITHDRAWAL'].includes(request.eventKind))return false;
 if(request.eventKind==='REPAYMENT')return account.fields.type===(request.role==='TARGET'?'LIABILITY':'ASSET');
 if(['INTERNAL_TRANSFER','WITHDRAWAL'].includes(request.eventKind))return account.fields.type==='ASSET';
 return true;
};

export function resolveAccount(request:AccountResolutionRequest,entities:Entity[],conflicts:Conflict[]=[]):AccountResolution{
 if(request.sponsored&&['PURCHASE','REFUND','RETURN'].includes(request.eventKind))return {state:'NOT_APPLICABLE',accountId:null,candidates:[],reason:'他人代付，不影响本人账户',memoryKey:null};
 if(emptyChannel(request.channelRaw))return {state:'UNRESOLVED',accountId:null,candidates:[],reason:'来源没有提供资金账户',memoryKey:null};
 if(needsSplitFunding(request.channelRaw))return {state:'SPLIT',accountId:null,candidates:[],reason:'来源包含多个资金账户，需要拆分资金影响',memoryKey:null};

 const descriptor=describeFundingChannel(request.platform,request.channelRaw);
 const normalized=channelKey(request.channelRaw);
 const memoryRole=request.role==='ACCOUNT'?'PRIMARY':request.eventKind==='REPAYMENT'?'REPAYMENT_TARGET':'TRANSFER_TARGET';
 const memoryKey={sourceSystem:request.sourceSystem,profile:request.profile,channelKey:descriptor?.identity||normalized,role:memoryRole};
 const accounts=entities.filter(e=>allowed(request,e));

 const candidates=accounts.filter(account=>{
  if(descriptor&&account.fields.type!==descriptor.type)return false;
  const name=channelKey(String(account.fields.name));
  if(descriptor&&name===channelKey(descriptor.name))return true;
  if(name===normalized)return true;
  if(descriptor?.last4){
   const accountLast4=String(account.fields.last4||'');
   const bank=descriptor.bank;
   return (accountLast4===descriptor.last4||name.includes('('+descriptor.last4+')'))&&(!bank||name.includes(bank));
  }
  return false;
 }).map(a=>a.id);

 const clear=candidates.filter(id=>!conflicts.some(c=>c.entity_type==='accounts'&&c.entity_id===id));
 if(clear.length===1)return {state:'RESOLVED',accountId:clear[0],candidates:clear,reason:'按明确资金渠道唯一匹配',memoryKey};
 if(candidates.length===1&&!clear.length)return {state:'CONFLICT',accountId:null,candidates,reason:'唯一候选账户存在同步冲突',memoryKey};

 // A remembered user decision may disambiguate multiple/renamed accounts, but never overrides a unique deterministic match above.
 if(request.rememberedAccountId){
  const remembered=accounts.find(a=>a.id===request.rememberedAccountId);
  if(!remembered)return {state:'INVALID_MEMORY',accountId:null,candidates:[],reason:'已记住的账户已不存在或不再适用',memoryKey};
  if(conflicts.some(c=>c.entity_type==='accounts'&&c.entity_id===remembered.id))return {state:'CONFLICT',accountId:null,candidates:[remembered.id],reason:'已记住的账户存在同步冲突',memoryKey};
  return {state:'RESOLVED',accountId:remembered.id,candidates:[remembered.id],reason:'使用已确认的账户关系',memoryKey};
 }
 if(clear.length>1)return {state:'SUGGESTED',accountId:null,candidates:clear,reason:'存在多个可能账户，需要选择一次',memoryKey};

 const weak=descriptor?.last4?accounts.filter(a=>String(a.fields.last4||'')===descriptor.last4).map(a=>a.id):[];
 return {state:weak.length?'SUGGESTED':'UNRESOLVED',accountId:null,candidates:weak,reason:weak.length?'有尾号相同的账户，需要确认':'没有找到对应账户，可绑定已有账户或新建',memoryKey};
}

/** Confirmed card identity survives renaming and payment platforms; wallet aliases remain scoped. */
export function resolveLedgerAccount(request:AccountResolutionRequest,entities:Entity[],conflicts:Conflict[]=[]):AccountResolution{
 const base=resolveAccount(request,entities,conflicts),key=base.memoryKey;
 if(base.state==='RESOLVED'||!key)return base;
 const exactId=accountMappingKey(key),exact=entities.find(e=>e.type==='import_rules'&&e.id===exactId);
 if(conflicts.some(c=>c.entity_type==='import_rules'&&c.entity_id===exactId))return {...base,state:'CONFLICT',reason:'账户关系存在同步冲突'};
 const direct=readAccountMapping(entities,key);
 if(direct)return resolveAccount({...request,rememberedAccountId:direct.accountId},entities,conflicts);
 // An explicit forget decision must not be recreated through another alias.
 if(exact||!/^.+:(?:credit|debit):\d{4}$/.test(key.channelKey))return base;
 const matching=entities.filter(e=>e.type==='import_rules'&&e.fields.value).flatMap(e=>{
  try{const value=JSON.parse(String(e.fields.value));return value.identity?.profile===key.profile&&value.identity?.channelKey===key.channelKey&&typeof value.accountId==='string'?[{id:e.id,accountId:value.accountId}]:[];}catch{return [];}
 });
 if(matching.some(m=>conflicts.some(c=>c.entity_type==='import_rules'&&c.entity_id===m.id)))return {...base,state:'CONFLICT',reason:'银行卡关系存在同步冲突'};
 const ids=[...new Set(matching.map(m=>m.accountId))];
 if(ids.length===1)return resolveAccount({...request,rememberedAccountId:ids[0]},entities,conflicts);
 return base;
}
