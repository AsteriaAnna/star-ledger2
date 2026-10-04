import {sha256} from '@noble/hashes/sha256';
import {bytesToHex} from '@noble/hashes/utils';
import type {Command,LedgerSnapshot} from '../accounting/index.ts';
import {accountMappingKey,rememberAccountMappingCommand} from '../importing/resolution-memory.ts';
import {channelKey,describeFundingChannel} from '../importing/channel.ts';
import {resolveAccount} from '../importing/account-resolution.ts';

export function planSetAccountAlias(input:{accountId:string;platform:'微信'|'支付宝';profile:string;channel:string;expectedSnapshot:string;now:string},ledger:LedgerSnapshot):Command[]{
 const context=accountMemoryContext(ledger);
 if(input.expectedSnapshot!==context.expectedSnapshot)throw Error('STALE_ACCOUNT_MEMORY');
 const profile=input.profile.trim(),channel=input.channel.trim();
 if(!profile||!channel)throw Error('ACCOUNT_ALIAS_REQUIRED');
 const result=resolveAccount({eventKind:'PURCHASE',sourceSystem:sourceSystem(input.platform),platform:input.platform,profile,channelRaw:channel,role:'ACCOUNT',sponsored:/亲情卡|亲属卡/.test(channel),rememberedAccountId:input.accountId},ledger.entities,ledger.conflicts);
 if(result.state!=='RESOLVED'||result.accountId!==input.accountId||!result.memoryKey)throw Error('ACCOUNT_ALIAS_NOT_APPLICABLE');
 return [rememberAccountMappingCommand(ledger.entities,result.memoryKey,{accountId:input.accountId,rememberedAt:input.now})];
}

const isMemory=(id:string)=>['alias-','instrument-','v2-account:'].some(prefix=>id.startsWith(prefix));
const sourceSystem=(platform:string)=>platform==='微信'?'WECHAT':platform==='支付宝'?'ALIPAY':'UNKNOWN';
const platformName=(system:string)=>({WECHAT:'微信',ALIPAY:'支付宝'} as Record<string,string>)[system]||system;
const channelName=(value:string)=>value.replace(/^(.+):(debit|credit):(\d{4})$/,(_,bank,kind,tail)=>`${bank}${kind==='credit'?'信用卡':'储蓄卡'}(${tail})`).replace(/^(微信|支付宝):/,'');
type Scope={platform:string;profile:string;channel:string;role:string;accountId:string;accountName:string;available:boolean};
export type AccountMemoryEntry={id:string;ruleIds:string[];scopes:Scope[];unreadable:boolean};

/** Compatibility aliases and their shared instrument fallback form one forgettable unit. */
export function accountMemoryContext(ledger:LedgerSnapshot){
 if(ledger.conflicts.length)throw Error('UNRESOLVED_CONFLICT');
 const all=ledger.entities.filter(e=>e.type==='import_rules'&&isMemory(e.id)).sort((a,b)=>a.id.localeCompare(b.id));
 const active=all.filter(e=>e.fields.value!==null),nodes=new Map(active.map(e=>[e.id,{row:e,links:new Set<string>(),scopes:[] as Scope[],unreadable:false}]));
 const connect=(a:string,b:string)=>{if(nodes.has(b)){nodes.get(a)!.links.add(b);nodes.get(b)!.links.add(a);}};
 for(const [id,node] of nodes){
  let v:any;try{v=JSON.parse(String(node.row.fields.value));if(!v||typeof v.accountId!=='string')throw Error();}catch{node.unreadable=true;continue;}
  const account=ledger.entities.find(e=>e.type==='accounts'&&e.id===v.accountId),available=!!account&&!account.fields.deleted_at;
  const identity=v.identity;
  const typed=id.startsWith('v2-account:')&&identity&&['sourceSystem','profile','channelKey','role'].every(k=>typeof identity[k]==='string');
  const legacy=id.startsWith('alias-')&&v.v===1&&['platform','profile','channel','role'].every(k=>typeof v[k]==='string');
  const scope:Scope={platform:typed?platformName(identity.sourceSystem):legacy?v.platform:'旧版共享渠道',profile:typed?identity.profile:legacy?v.profile:'归属未记录',channel:typed?channelName(identity.channelKey):legacy?v.channel:'渠道信息未记录',role:typed?identity.role==='PRIMARY'?'付款 / 到账账户':'目标账户':legacy?v.role==='repayment-target'?'转入 / 还款账户':v.role:'多个旧入口共用',accountId:v.accountId,accountName:String(account?.fields.name||'账户不可用'),available};
  node.scopes.push(scope);
  if(legacy){
   const descriptor=describeFundingChannel(v.platform,v.channel);
   if(descriptor)connect(id,'instrument-'+bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([v.profile,descriptor.identity])))));
   if(['付款账户','到账账户'].includes(v.role))connect(id,accountMappingKey({sourceSystem:sourceSystem(v.platform),profile:v.profile,channelKey:descriptor?.identity||channelKey(v.channel),role:'PRIMARY'}));
  }
 }
 const entries:AccountMemoryEntry[]=[],seen=new Set<string>();
 for(const id of nodes.keys()){
  if(seen.has(id))continue;const stack=[id],ruleIds:string[]=[],scopes:Scope[]=[];let unreadable=false;
  while(stack.length){const key=stack.pop()!;if(seen.has(key))continue;seen.add(key);const node=nodes.get(key)!;ruleIds.push(key);scopes.push(...node.scopes);unreadable||=node.unreadable;stack.push(...node.links);}
  ruleIds.sort();const detailed=scopes.filter(s=>s.platform!=='旧版共享渠道');
  // Orphaned old instrument entries remain visible and can still be forgotten.
  const display=detailed.length?detailed:scopes;
  entries.push({id:ruleIds[0],ruleIds,scopes:[...new Map(display.map(s=>[JSON.stringify(s),s])).values()],unreadable});
 }
 return {entries,expectedSnapshot:JSON.stringify(all.map(e=>[e.id,e.fields.rule_key,e.fields.value]))};
}

export function planForgetAccountMemory(input:{entryIds:readonly string[]|'ALL';expectedSnapshot:string},ledger:LedgerSnapshot):Command[]{
 const context=accountMemoryContext(ledger);if(input.expectedSnapshot!==context.expectedSnapshot)throw Error('STALE_ACCOUNT_MEMORY');
 const entries=input.entryIds==='ALL'?context.entries:input.entryIds.map(id=>{const entry=context.entries.find(e=>e.id===id);if(!entry)throw Error('ACCOUNT_MEMORY_UNAVAILABLE');return entry;});
 const ids=new Set(entries.flatMap(e=>e.ruleIds));
 return [...ids].map(id=>({action:'PATCH_FIELD',entity:{type:'import_rules',id,fields:{value:null}}}));
}
