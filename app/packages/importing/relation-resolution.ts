import type {Entity} from '../domain/index.ts';

export type RefundResolutionInput={
 kind:'REFUND'|'RETURN';
 amountFen:number;
 occurredAt:string;
 platform:string;
 profile:string;
 displayName:string;
 originalOrderId:string|null;
 orderId:string|null;
 statusRaw:string;
 productRaw:string;
 manualOriginalId?:string|null;
};

export type RefundRelationResolution={
 state:'RESOLVED'|'SUGGESTED'|'UNRESOLVED'|'INVALID_MANUAL';
 originalId:string|null;
 candidates:string[];
 destinationAccountId:string|null;
 sponsored:boolean|null;
 reason:string;
 evidence:'MANUAL'|'ORIGINAL_ORDER'|'REFUND_ANNOTATION'|'MERCHANT_AMOUNT_TIME'|'NONE';
};

type SourceEvidence={transactionId:string;order:string;profile:string;original:Record<string,string>};

const json=(v:unknown):any=>{try{return JSON.parse(String(v));}catch{return undefined;}};
const merchant=(value:string)=>value.replace(/(?:[-－—]?退款)$|^退款[-－—]?|\s/g,'');

export function refundAnnotation(statusText:string):{kind:'full'}|{kind:'partial';amountFen:number}|null{
 if(!statusText)return null;
 if(/已全额退款/.test(statusText))return {kind:'full'};
 const m=statusText.match(/已退款[（(]?[¥￥]\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/);
 if(!m)return null;
 const n=Number(m[1].replace(/,/g,''));return Number.isFinite(n)?{kind:'partial',amountFen:Math.round(n*100)}:null;
}

function sources(entities:Entity[],platform:string,profile:string):SourceEvidence[]{
 const out:SourceEvidence[]=[];
 for(const source of entities.filter(e=>e.type==='source_records'&&e.fields.platform===platform)){
  const payload=json(source.fields.raw_payload);if(!payload||payload.profile&&payload.profile!==profile)continue;
  const original=json(payload.original)||{};
  out.push({transactionId:String(source.fields.transaction_id),order:String(payload.order||''),profile:String(payload.profile||'本人'),original});
 }
 return out;
}

function activeOriginals(input:RefundResolutionInput,entities:Entity[]){
 const at=Date.parse(input.occurredAt);
 return entities.filter(e=>{
  if(e.type!=='transactions'||e.fields.deleted_at||e.fields.purged_at||e.fields.status!=='SUCCESS')return false;
  if(input.kind==='REFUND'&&e.fields.event_type!=='PURCHASE')return false;
  if(input.kind==='RETURN'&&!['EXTERNAL_TRANSFER','DEPOSIT','RED_PACKET'].includes(String(e.fields.event_type)))return false;
  if(Date.parse(String(e.fields.occurred_at))>at)return false;
  const returned=entities.filter(link=>link.type==='transaction_links'&&!link.fields.deleted_at&&link.fields.to_transaction_id===e.id)
   .map(link=>entities.find(t=>t.type==='transactions'&&t.id===link.fields.from_transaction_id))
   .filter(t=>t&&!t.fields.deleted_at&&!t.fields.purged_at&&t.fields.status==='SUCCESS')
   .reduce((sum,t)=>sum+Number(t!.fields.display_amount),0);
  return returned+input.amountFen<=Number(e.fields.display_amount);
 });
}

function resultFor(input:RefundResolutionInput,entities:Entity[],original:Entity,evidence:RefundRelationResolution['evidence'],reason:string):RefundRelationResolution{
 const movements=entities.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id===original.id&&e.fields.amount!==0);
 return {state:'RESOLVED',originalId:original.id,candidates:[original.id],destinationAccountId:movements.length===1?String(movements[0].fields.account_id||'')||null:null,sponsored:movements.length===0,reason,evidence};
}

export function resolveRefundRelation(input:RefundResolutionInput,entities:Entity[]):RefundRelationResolution{
 const none:RefundRelationResolution={state:'UNRESOLVED',originalId:null,candidates:[],destinationAccountId:null,sponsored:null,reason:'退款事实可以先处理，原交易关系稍后补充',evidence:'NONE'};
 if(!Number.isSafeInteger(input.amountFen)||input.amountFen<=0||!Number.isFinite(Date.parse(input.occurredAt)))return none;
 const originals=activeOriginals(input,entities);
 if(input.manualOriginalId!==undefined){
  const original=originals.find(t=>t.id===input.manualOriginalId);
  return original?resultFor(input,entities,original,'MANUAL','使用用户确认的原交易'):{...none,state:'INVALID_MANUAL',reason:'用户选择的原交易已不存在或不满足退款约束'};
 }
 const source= sources(entities,input.platform,input.profile);

 if(input.originalOrderId){
  const ids=new Set(source.filter(s=>s.order===input.originalOrderId).map(s=>s.transactionId));
  const matches=originals.filter(t=>ids.has(t.id));
  if(matches.length===1)return resultFor(input,entities,matches[0],'ORIGINAL_ORDER','按原订单号唯一关联');
  if(matches.length>1)return {...none,state:'SUGGESTED',candidates:matches.map(t=>t.id),reason:'原订单号对应多笔候选，需要确认',evidence:'ORIGINAL_ORDER'};
 }

 const annotation=input.kind==='REFUND'&&input.platform==='微信'?refundAnnotation(input.statusRaw):null;
 if(annotation){
  const ids=new Set(source.filter(s=>{
   const a=refundAnnotation(s.original['当前状态']||'');if(!a)return false;
   if(annotation.kind==='full')return a.kind==='full';
   return a.kind==='partial'&&a.amountFen===annotation.amountFen;
  }).map(s=>s.transactionId));
  const matches=originals.filter(t=>ids.has(t.id)&& (annotation.kind!=='full'||Number(t.fields.display_amount)===input.amountFen));
  if(matches.length===1)return resultFor(input,entities,matches[0],'REFUND_ANNOTATION','按平台退款状态标注唯一关联');
  if(matches.length>1)return {...none,state:'SUGGESTED',candidates:matches.map(t=>t.id),reason:'退款状态标注对应多笔候选，需要确认',evidence:'REFUND_ANNOTATION'};
 }

 // Merchant/amount/time is intentionally suggestion-only: it is useful evidence, but not a durable external identity.
 const name=merchant(input.displayName),at=Date.parse(input.occurredAt);
 const candidates=originals.filter(t=>{
  const delta=at-Date.parse(String(t.fields.occurred_at));
  if(delta<0||delta>90*86400000||Number(t.fields.display_amount)!==input.amountFen)return false;
  if(input.kind==='RETURN'&&input.productRaw){
   const matchingSource=source.filter(s=>s.transactionId===t.id);
   if(matchingSource.some(s=>s.original['商品']===input.productRaw||s.original['商品说明']===input.productRaw))return true;
  }
  return !!name&&merchant(String(t.fields.display_name))===name;
 });
 if(candidates.length)return {...none,state:'SUGGESTED',candidates:candidates.map(t=>t.id),reason:candidates.length===1?'找到相同商户、金额和时间范围的候选，请确认':'找到多个相似候选，请确认',evidence:'MERCHANT_AMOUNT_TIME'};
 return none;
}
