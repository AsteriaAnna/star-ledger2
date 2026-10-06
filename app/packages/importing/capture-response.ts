/** R03/C02: strict adapter for the frozen official API experiment. Candidates are not facts. */
export type CaptureField={label:string;value:string|null};
export type CaptureIdentifier={role:string;value:string|null};
export type CaptureTime={role:string;value:string|null;precision:string};
export type CaptureMoneyLine={role:string;amount:string|number|null;time:string|null;status:string|null};
export type CaptureResponse={schemaVersion:'experiment-1';platform:string|null;displayAmount:string|number|null;status:string|null;merchant:string|null;paymentMethod:string|null;fields:CaptureField[];identifiers:CaptureIdentifier[];times:CaptureTime[];moneyLines:CaptureMoneyLine[];uncertain:string[]};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('INVALID_CAPTURE_RESPONSE_SHAPE');return v as Record<string,unknown>;};
const text=(v:unknown):string|null=>{if(v===null)return null;if(typeof v!=='string'||v.length>4000)throw Error('INVALID_CAPTURE_RESPONSE_FIELD');return v;};
const label=(v:unknown):string=>{const s=text(v);if(!s?.trim())throw Error('INVALID_CAPTURE_RESPONSE_LABEL');return s;};
const money=(v:unknown):string|number|null=>{if(v===null||typeof v==='string')return text(v);if(typeof v==='number'&&Number.isFinite(v))return v;throw Error('INVALID_CAPTURE_RESPONSE_MONEY');};
const array=(v:unknown):unknown[]=>{if(!Array.isArray(v)||v.length>256)throw Error('INVALID_CAPTURE_RESPONSE_ARRAY');return v;};
export function parseCaptureResponse(raw:string,schemaVersion:string):CaptureResponse{
 if(schemaVersion!=='experiment-1')throw Error('UNSUPPORTED_CAPTURE_RESPONSE_SCHEMA');
 if(typeof raw!=='string'||raw.length>200000)throw Error('INVALID_CAPTURE_RESPONSE_SIZE');
 let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw Error('INVALID_CAPTURE_RESPONSE_JSON');}
 const e=object(object(parsed).evidence);
 const visible=(v:unknown)=>{const x=object(v);if(typeof x.visible!=='boolean')throw Error('INVALID_CAPTURE_RESPONSE_VISIBILITY');return x;};
 return {schemaVersion,platform:text(e.platform),displayAmount:money(e.displayAmount),status:text(e.status),merchant:text(e.merchant),paymentMethod:text(e.paymentMethod),
  fields:array(e.fields).map(visible).filter(x=>x.visible).map(x=>({label:label(x.label),value:text(x.value)})),
  identifiers:array(e.identifiers).map(visible).filter(x=>x.visible).map(x=>({role:label(x.role),value:text(x.value)})),
  times:array(e.times).map(object).map(x=>({role:label(x.role),value:text(x.value),precision:label(x.precision)})),
  moneyLines:array(e.moneyLines).map(object).map(x=>({role:label(x.role),amount:money(x.amount),time:text(x.time),status:text(x.status)})),
  uncertain:array(e.uncertain).map(label)};
}
/** No floating point multiplication, rounding, exponent, thousands separator or inferred currency. */
export function captureMoneyFen(raw:string|number|null):number|null{
 if(raw===null)return null;
 const s=String(raw).trim().replace(/^[¥￥]\s*/,''),m=s.match(/^[+-]?(\d+)(?:\.(\d{1,2}))?$/);
 if(!m)return null;const value=BigInt(m[1])*100n+BigInt((m[2]??'').padEnd(2,'0'));
 return value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):null;
}
/** China local dates; precision retained separately. Never invent a missing date/current date. */
export function captureTime(raw:string|null,declared?:string):{occurredAt:string|null;precision:'second'|'minute'|'day'|'invalid'}{
 const invalid={occurredAt:null,precision:'invalid' as const};if(!raw)return invalid;
 const m=raw.trim().match(/^(\d{4})[-年](\d{1,2})[-月](\d{1,2})日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);if(!m)return invalid;
 const [y,mo,d,h,mi,s]=m.slice(1).map(v=>v===undefined?0:Number(v)),precision=m[6]!==undefined?'second':m[4]!==undefined?'minute':'day';
 const date=new Date(Date.UTC(y,mo-1,d,h,mi,s));if(y<1970||date.getUTCFullYear()!==y||date.getUTCMonth()!==mo-1||date.getUTCDate()!==d||h>23||mi>59||s>59)return invalid;
 const aliases:Record<string,string>={秒:'second',分钟:'minute',分:'minute',日:'day',天:'day'};
 if(declared&&declared!=='unknown'&&(aliases[declared]??declared)!==precision)return invalid;
 return {occurredAt:new Date(date.getTime()-8*3600000).toISOString(),precision};
}
