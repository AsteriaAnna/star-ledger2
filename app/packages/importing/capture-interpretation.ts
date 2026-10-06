import {captureMoneyFen,captureTime,type CaptureResponse,type CaptureMoneyLine} from './capture-response.ts';
import type {CaptureObservation} from './capture-evidence.ts';
import type {EventInterpretation,ExternalRecord,InterpretedEventKind,NormalizedSourceFacts} from './types.ts';
export type CaptureIssue={code:string;region:string};
const unique=(values:(string|null)[])=>{const set=new Set(values.filter((v):v is string=>!!v));return set.size===1?[...set][0]:null;};
/** System interpretation uses evidence labels, never candidates.kind or a merchant pretending to be a platform. */
export function interpretCaptureFacts(response:CaptureResponse,sourceSystem:'WECHAT'|'ALIPAY'){
 const issues:CaptureIssue[]=[],get=(pattern:RegExp)=>unique(response.fields.filter(f=>pattern.test(f.label)).map(f=>f.value));
 const ledgerRecord=/星账|记账/.test(response.platform??'')||response.times.some(t=>t.role==='记录时间');
 if(ledgerRecord)return {pageKind:'ledger_record' as const,observations:[] as CaptureObservation[],kinds:[] as InterpretedEventKind[],issues};
 const observations:CaptureObservation[]=[],kinds:InterpretedEventKind[]=[];
 const id=(pattern:RegExp)=>{
  const values=response.identifiers.filter(x=>pattern.test(x.role)).map(x=>x.value);
  const value=unique(values);if(new Set(values.filter(Boolean)).size>1)issues.push({code:'CONFLICTING_CAPTURE_IDENTIFIERS',region:pattern.source});
  if(value&&(!/^[A-Za-z0-9_-]+$/.test(value)||value.length>256)){issues.push({code:'INVALID_CAPTURE_IDENTIFIER',region:pattern.source});return null;}return value;
 };
 const order=id(/^(交易单号|交易订单号|交易号|订单号|转账单号|提现单号)$/),refundId=id(/^退款(单号|订单号)$/),parent=id(/^原(交易单号|订单号|交易订单号)$/);
 const paymentChannel=response.paymentMethod??get(/^(支付方式|付款方式|退款方式)$/)??'';
 const status=response.status??get(/^(当前状态|退款状态)$/)??'';
 const withdrawal=response.fields.some(f=>f.label==='提现金额')||response.moneyLines.some(l=>l.role==='提现金额');
 const recharge=response.times.some(t=>t.role==='充值时间')||response.moneyLines.some(l=>l.role==='充值金额');
 const transfer=response.times.some(t=>t.role==='转账时间')||response.identifiers.some(i=>i.role==='转账单号');
 const timeFor=(line:CaptureMoneyLine,refund:boolean)=>{
  if(withdrawal&&!refund){const arrival=response.times.filter(t=>t.role==='到账时间');if(arrival.length===1)return captureTime(arrival[0].value,arrival[0].precision);}
  if(line.time)return captureTime(line.time);
  const found=response.times.filter(t=>refund?/^退款时间/.test(t.role):withdrawal?/^(到账时间|申请时间)$/.test(t.role):recharge?t.role==='充值时间':/^(支付时间|转账时间|收款时间|交易时间)$/.test(t.role));
  const preferred=withdrawal?found.filter(t=>t.role==='到账时间'):found;
  const group=preferred.length?preferred:found;
  if(group.length!==1)return captureTime(null);return captureTime(group[0].value,group[0].precision);
 };
 const refunds=response.moneyLines.filter(l=>/^退款(金额)?$/.test(l.role));
 const summary=response.moneyLines.filter(l=>/合计|总计|汇总/.test(l.role));
 const fee=captureMoneyFen(get(/^(服务费|手续费)$/)??response.moneyLines.find(l=>/^(服务费|手续费)$/.test(l.role))?.amount??null);
 const refundSummary=status.match(/已退款\s*\([¥￥]?\s*(\d+(?:\.\d{1,2})?)\)/)?.[1];
 if(refundSummary){const total=captureMoneyFen(refundSummary);if(!refunds.length||refunds.some(l=>captureMoneyFen(l.amount)===null)||refunds.reduce((n,l)=>n+(captureMoneyFen(l.amount)??0),0)!==total)issues.push({code:'REFUND_SUMMARY_MISMATCH',region:'refund-summary'});}
 for(const line of response.moneyLines){
  if(!/^(支出|收入|支付金额|付款金额|提现金额|充值金额|退款|退款金额)$/.test(line.role)&&!(/合计|总计|汇总/.test(line.role))&&!(withdrawal&&/^(服务费|手续费)$/.test(line.role)))issues.push({code:'UNSUPPORTED_CAPTURE_MONEY_ROLE',region:'moneyLines:'+response.moneyLines.indexOf(line)});
 }
 const relevant=response.moneyLines.filter(l=>/^(支出|收入|支付金额|付款金额|提现金额|充值金额|退款|退款金额)$/.test(l.role));
 if(!relevant.length){issues.push({code:'CAPTURE_EVENT_EVIDENCE_MISSING',region:'page'});return {pageKind:'unknown' as const,observations,kinds,issues};}
 for(const line of relevant){
  const ordinal=response.moneyLines.indexOf(line),isRefund=/^退款/.test(line.role),region='moneyLines:'+ordinal;
  const kind:InterpretedEventKind=isRefund?(transfer?'RETURN':'REFUND'):withdrawal?'WITHDRAWAL':recharge?(sourceSystem==='WECHAT'?'INTERNAL_TRANSFER':'UNKNOWN'):transfer?'DEPOSIT':line.role==='收入'?'INCOME':'PURCHASE';
  const time=timeFor(line,isRefund),lineStatus=withdrawal?status:line.status??status;
  const success=/成功|已到账|已退款|已退还|已存入|充值完成|完成/.test(lineStatus)||(!isRefund&&/已退款|已退还/.test(status))||(!isRefund&&response.times.some(t=>t.role==='支付时间'));
  const failed=/失败|已关闭|已取消/.test(lineStatus),pending=/处理中|等待付款|待支付|待收款/.test(lineStatus);
  const facts:NormalizedSourceFacts={amountFen:captureMoneyFen(line.amount),occurredAt:time.occurredAt,precision:time.precision,
   transactionTypeRaw:kind,directionRaw:isRefund||line.role==='收入'?'收入':'支出',statusRaw:failed?'FAILED':pending?'PENDING':success?'SUCCESS':'UNKNOWN',
   channelRaw:withdrawal&&sourceSystem==='WECHAT'?'微信零钱':paymentChannel,
   ...(withdrawal?{feeFen:fee,targetChannelRaw:get(/^提现银行$/)??paymentChannel}:recharge&&sourceSystem==='WECHAT'?{targetChannelRaw:'微信零钱'}:{}),
   counterpartyRaw:response.merchant??'',productRaw:get(/^(商品|商品说明|交易详情|转账说明)$/)??'',noteRaw:'',sourceCategoryRaw:get(/^交易分类$/)??'',
   orderId:isRefund?null:order,refundId:isRefund&&refunds.length===1?refundId:null,originalOrderId:isRefund?(parent??order):null};
  if(isRefund&&refunds.length>1&&refundId)issues.push({code:'AMBIGUOUS_REFUND_IDENTIFIER',region});
  observations.push({role:'EVENT',key:region,region,ordinal,sourceClass:isRefund?'refund':'payment',facts});kinds.push(kind);
 }
 // Summaries remain extraction evidence; they cannot become extra postings.
 for(const line of summary)issues.push({code:'SUMMARY_NOT_EVENT',region:'moneyLines:'+response.moneyLines.indexOf(line)});
 return {pageKind:'payment_detail' as const,observations,kinds,issues};
}
export function captureInterpretations(records:ExternalRecord[],kinds:InterpretedEventKind[]):EventInterpretation[]{
 if(records.length!==kinds.length)throw Error('CAPTURE_INTERPRETATION_COUNT_MISMATCH');
 return records.map((r,i)=>({externalRecordId:r.id,eventKind:kinds[i],status:['SUCCESS','FAILED','PENDING'].includes(r.facts.statusRaw)?r.facts.statusRaw as EventInterpretation['status']:'UNKNOWN',amountFen:r.facts.amountFen,occurredAt:r.facts.occurredAt,
  displayName:r.facts.counterpartyRaw||r.facts.productRaw||'账单记录',channelRaw:r.facts.channelRaw,categorySuggestion:null,
  evidence:[{kind:'DETERMINISTIC_RULE',code:'CAPTURE_FACTS_V1',sourceFields:[r.capture!.region],detail:'模型候选不决定资金事件；按可见金额/时间/状态解释'}]}));
}
