import type {Draft} from './importer.ts';
import {money,sourceUTC} from './normalize.ts';
import type {
 EventInterpretation,ExternalRecord,InterpretedEventKind,NormalizedSourceFacts,SourceSystem
} from '../../../packages/importing/types.ts';

const rawObject=(raw:string):Record<string,string>=>{
 try{
  const value=JSON.parse(raw);
  if(value&&typeof value==='object'&&!Array.isArray(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,String(v??'')]));
 }catch{}
 return {};
};
const first=(row:Record<string,string>,keys:string[])=>{
 for(const key of keys)if(row[key]&&row[key]!=='/'&&row[key]!=='-')return row[key];
 return '';
};
const system=(draft:Draft):SourceSystem=>draft.sourceType==='SCREENSHOT'?'SCREENSHOT':draft.platform==='微信'?'WECHAT':draft.platform==='支付宝'?'ALIPAY':'UNKNOWN';
const eventKind=(kind:string):InterpretedEventKind=>{
 const allowed:InterpretedEventKind[]=['PURCHASE','INCOME','TRANSFER_IN','INTERNAL_TRANSFER','WITHDRAWAL','EXTERNAL_TRANSFER','DEPOSIT','RED_PACKET','REPAYMENT','REFUND','RETURN','UNKNOWN'];
 return allowed.includes(kind as InterpretedEventKind)?kind as InterpretedEventKind:'UNKNOWN';
};
const amountFen=(draft:Draft)=>{try{return money(draft.amount);}catch{return null;}};
const occurredAt=(draft:Draft)=>{try{return sourceUTC(draft.date);}catch{return null;}};

export function legacyDraftToExternalRecord(draft:Draft,sessionId:string,capturedAt:string,observationId?:string):ExternalRecord{
 const row=rawObject(draft.raw);
 const facts:NormalizedSourceFacts={
  occurredAt:occurredAt(draft),
  amountFen:amountFen(draft),
  feeFen:(()=>{if(draft.kind==='WITHDRAWAL'&&draft.platform==='微信'&&(draft.blockers||[]).includes('TRANSFER')&&(draft.fee||'0')==='0')return null;try{return money(draft.fee||'0');}catch{return null;}})(),
  transactionTypeRaw:first(row,['交易类型','交易分类']),
  directionRaw:first(row,['收/支','收支']),
  statusRaw:first(row,['当前状态','交易状态','状态']),
  channelRaw:first(row,['支付方式','收/付款方式','付款方式'])||draft.channel,
  counterpartyRaw:first(row,['交易对方','对方名称']),
  productRaw:first(row,['商品说明','商品名称','商品']),
  noteRaw:first(row,['备注']),
  sourceCategoryRaw:draft.sourceCategory||first(row,['交易分类']),
  orderId:first(row,['交易单号','交易订单号','交易号'])||draft.order||null,
  refundId:first(row,['退款单号','退款订单号'])||null,
  originalOrderId:first(row,['原交易单号','原订单号','原交易订单号'])||draft.originalOrder||null,
  precision:draft.precision||'invalid'
 };
 return {
  id:observationId??draft.itemId||draft.identity||draft.key,
  sessionId,
  sourceIdentity:draft.identity||draft.key,
  sourceType:draft.sourceType,
  sourceSystem:system(draft),
  platformRaw:draft.platform,
  profile:draft.profile||'本人',
  rawPayload:draft.raw,
  facts,
  parserVersion:draft.parserVersion||0,
  capturedAt
 };
}

export function legacyDraftToInterpretation(draft:Draft,record:ExternalRecord):EventInterpretation{
 const evidence=[{
  kind:'DETERMINISTIC_RULE' as const,
  code:'LEGACY_PARSER_V3',
  sourceFields:['交易类型','收/支','当前状态','支付方式','交易单号'],
  detail:'M4 过渡适配：保持 v0.9 解析结果不变，后续由 importing/interpret.ts 逐条替换。'
 }];
 return {
  externalRecordId:record.id,
  eventKind:eventKind(draft.kind),
  status:['SUCCESS','PENDING','FAILED'].includes(draft.status)?draft.status as EventInterpretation['status']:'UNKNOWN',
  amountFen:record.facts.amountFen,
  occurredAt:record.facts.occurredAt,
  displayName:draft.name,
  channelRaw:record.facts.channelRaw,
  categorySuggestion:draft.category||null,
  evidence
 };
}
