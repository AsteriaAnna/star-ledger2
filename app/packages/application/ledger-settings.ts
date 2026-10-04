import type {Command,LedgerSnapshot} from '../accounting/index.ts';

export const ledgerSettingKeys=['budget','categories'] as const;
type Key=typeof ledgerSettingKeys[number];
const idFor=(key:Key)=>'ledger-setting:'+key;
function validateSetting(key:Key,value:unknown){
 if(key==='budget'){
  if(value!==null&&(!Number.isSafeInteger(value)||Number(value)<=0))throw Error('INVALID_MONEY');
 }else if(!Array.isArray(value)||value.some(v=>typeof v!=='string'||!v.trim()||v.length>60)||new Set(value).size!==value.length)throw Error('INVALID_CATEGORIES');
}
export function ledgerSettings(ledger:LedgerSnapshot,fallback:Record<string,any>){
 const result={...fallback};
 for(const key of ledgerSettingKeys){
  const row=ledger.entities.find(e=>e.type==='ledger_settings'&&e.id===idFor(key));
  if(!row)continue;
  if(ledger.conflicts.some(c=>c.entity_type==='ledger_settings'&&c.entity_id===row.id)){
   result[key]=key==='budget'?null:[];continue;
  }
  const value=JSON.parse(String(row.fields.value));validateSetting(key,value);result[key]=value;
 }
 return result;
}
export function planLedgerSettings(values:Record<string,any>,ledger:LedgerSnapshot):Command[]{
 return ledgerSettingKeys.flatMap(key=>{
  if(!Object.hasOwn(values,key))return [];
  validateSetting(key,values[key]);
  const id=idFor(key),row=ledger.entities.find(e=>e.type==='ledger_settings'&&e.id===id),value=JSON.stringify(values[key]);
  if(ledger.conflicts.some(c=>c.entity_type==='ledger_settings'&&c.entity_id===id))throw Error('UNRESOLVED_CONFLICT');
  if(row?.fields.value===value)return [];
  return [{action:row?'PATCH_FIELD':'CREATE_ENTITY',entity:{type:'ledger_settings',id,fields:row?{value}:{setting_key:key,value}}} as Command];
 });
}
/** Import old local settings only after remote history has been read, never over an existing ledger value. */
export function planLegacyLedgerSettings(local:Record<string,any>,ledger:LedgerSnapshot){
 const missing=Object.fromEntries(ledgerSettingKeys.filter(key=>Object.hasOwn(local,key)&&!ledger.entities.some(e=>e.type==='ledger_settings'&&e.id===idFor(key))).map(key=>[key,local[key]]));
 return planLedgerSettings(missing,ledger);
}
