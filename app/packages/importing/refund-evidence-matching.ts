import type {Entity,Conflict} from '../domain/index.ts';
import type {ExternalRecord,EventInterpretation,NormalizedSourceFacts} from './types.ts';
import {strongSourceEventIdentity} from './source-event-identity.ts';
import {refundOriginalOrder} from './refund-order.ts';

type Observation={recordId:string|null;transactionId:string|null;identity:string;platform:string;profile:string;ownId:string|null;parent:string|null;facts:NormalizedSourceFacts};
export type RefundEvidenceMatch={transactionId:string|null;recordId:string|null;candidates:string[];automatic:boolean};
const json=(v:unknown):any=>{try{return JSON.parse(String(v));}catch{return null;}};
const clean=(value:unknown)=>typeof value==='string'?value.trim():'';
function observation(record:ExternalRecord):Observation|null{
 const f=record.facts,own=clean(f.refundId)||clean(f.orderId);
 const strong=own&&record.sourceIdentity===strongSourceEventIdentity(record.platformRaw,record.profile,'refund',own);
 if(record.capture?.sourceClass!=='refund'&&!strong)return null;
 if(record.capture?.identityStrength==='OBSERVATION'&&strong)return null;
 if(!Number.isSafeInteger(f.amountFen)||Number(f.amountFen)<=0||!f.occurredAt||!Number.isFinite(Date.parse(f.occurredAt)))return null;
 return {recordId:record.id,transactionId:null,identity:record.sourceIdentity,platform:record.platformRaw,profile:record.profile,ownId:strong?own:null,parent:refundOriginalOrder(record.platformRaw,strong?own:null,f.originalOrderId),facts:f};
}
function storedObservations(entities:Entity[],conflicts:Conflict[]){
 const out:Observation[]=[],transactions=new Map(entities.filter(e=>e.type==='transactions').map(e=>[e.id,e]));
 for(const source of entities){
  if(source.type!=='source_records')continue;
  const payload=json(source.fields.raw_payload),original=json(payload?.original),facts=payload?.capture?original?.facts:payload?.normalizedFacts;
  if(payload?.version!==3||!facts||!payload.identity||!payload.profile)continue;
  const transactionId=String(source.fields.transaction_id),target=transactions.get(transactionId);
  if(!target||target.fields.purged_at||conflicts.some(c=>c.entity_id===transactionId&&c.entity_type==='transactions'))continue;
  const o=observation({id:source.id,sessionId:'stored',sourceIdentity:payload.identity,platformRaw:String(source.fields.platform),profile:payload.profile,facts,capture:payload.capture,sourceType:source.fields.source_type as 'SCREENSHOT',sourceSystem:payload.sourceSystem,rawPayload:payload.original,parserVersion:payload.parserVersion,capturedAt:String(source.fields.created_at)});
  if(o&&/成功|已退还|已退款|退款完成/.test(clean(facts.statusRaw)))out.push({...o,recordId:null,transactionId});
 }
 return out;
}
function timeInterval(f:NormalizedSourceFacts){
 const n=Date.parse(f.occurredAt!);const size=f.precision==='second'?1000:f.precision==='minute'?60000:f.precision==='day'?86400000:0;
 if(!size)return null;
 // Day precision is only a candidate and uses the source's +08:00 accounting day.
 const start=size===86400000?Math.floor((n+8*3600000)/size)*size-8*3600000:Math.floor(n/size)*size;
 return {start,end:start+size};
}
function compare(a:Observation,b:Observation):'EXACT'|'CANDIDATE'|null{
 if(a.platform!==b.platform||a.profile!==b.profile||a.facts.amountFen!==b.facts.amountFen)return null;
 if(a.ownId&&b.ownId&&a.ownId!==b.ownId)return null;
 if(a.parent&&b.parent&&a.parent!==b.parent)return null;
 const x=timeInterval(a.facts),y=timeInterval(b.facts);if(!x||!y||x.end<=y.start||y.end<=x.start)return null;
 const channelsAgree=clean(a.facts.channelRaw)===clean(b.facts.channelRaw)&&clean(a.facts.targetChannelRaw)===clean(b.facts.targetChannelRaw);
 const feesAgree=(a.facts.feeFen??0)===(b.facts.feeFen??0);
 const parentsAgree=a.parent===b.parent;
 const sameOwn=!!a.ownId&&a.ownId===b.ownId;
 const sameObservation=a.identity===b.identity;
 const parentAnchor=!!a.parent&&a.parent===b.parent;
 if(channelsAgree&&feesAgree&&parentsAgree&&a.facts.precision==='second'&&b.facts.precision==='second'&&Date.parse(a.facts.occurredAt!)===Date.parse(b.facts.occurredAt!)&&(sameOwn||sameObservation||parentAnchor&&!!(a.ownId||b.ownId)))return 'EXACT';
 // Similar amount/time alone is never an automatic identity. Require a parent or merchant anchor for a candidate.
 const merchant=clean(a.facts.counterpartyRaw),sameMerchant=!!merchant&&merchant===clean(b.facts.counterpartyRaw);
 return sameOwn||parentAnchor||sameMerchant?'CANDIDATE':null;
}

/** Supplement immutable source evidence, never rewrite financial or user-edited facts. */
export function planRefundEvidenceMatches(records:ExternalRecord[],interpretations:EventInterpretation[],entities:Entity[],conflicts:Conflict[]=[]){
 const meaning=new Map(interpretations.map(i=>[i.externalRecordId,i]));
 const incoming=records.flatMap(r=>{const i=meaning.get(r.id),o=observation(r);return o&&i?.eventKind==='REFUND'&&i.status==='SUCCESS'&&i.amountFen===r.facts.amountFen&&i.occurredAt===r.facts.occurredAt?[o]:[];});
 const stored=storedObservations(entities,conflicts),known=new Map<string,Set<string>>();
 for(const o of stored)if(o.ownId){const ids=known.get(o.transactionId!)??new Set<string>();ids.add(o.ownId);known.set(o.transactionId!,ids);}
 const candidates=(o:Observation)=>{
  const map=new Map<string,{observation:Observation;automatic:boolean}>();
  for(const other of stored){
   if(o.ownId&&known.get(other.transactionId!)?.size&&!known.get(other.transactionId!)!.has(o.ownId))continue;
   const relation=compare(o,other);if(!relation)continue;
   const old=map.get(other.transactionId!);map.set(other.transactionId!,{observation:other,automatic:old?.automatic===true||relation==='EXACT'});
  }
  return map;
 };
 const sets=new Map(incoming.map(o=>[o.recordId!,candidates(o)]));
 // Prefer a numbered observation as the representative for an uncommitted mixed batch.
 // A weak observation follows that representative's durable target if it already exists.
 for(const o of incoming){
  if(o.ownId||sets.get(o.recordId!)!.size)continue;
  const numbered=incoming.filter(other=>other.ownId&&compare(o,other)!==null);
  for(const other of numbered){
   const targets=sets.get(other.recordId!)!;
   if(targets.size){for(const [id,target] of targets)sets.get(o.recordId!)!.set(id,{observation:target.observation,automatic:target.automatic&&compare(o,other)==='EXACT'});}
   else{
    const competing=numbered.filter(v=>v.ownId===other.ownId);
    const incompatible=competing.some(v=>records.find(r=>r.id===v.recordId)!.rawPayload!==records.find(r=>r.id===other.recordId)!.rawPayload);
    const sameNumber=numbered.filter(v=>v.ownId===other.ownId).sort((a,b)=>a.recordId!.localeCompare(b.recordId!))[0];
    sets.get(o.recordId!)!.set('record:'+sameNumber.recordId,{observation:sameNumber,automatic:!incompatible&&compare(o,other)==='EXACT'});
   }
  }
 }
 const claims=new Map<string,Set<string>>();
 for(const o of incoming)for(const key of sets.get(o.recordId!)!.keys()){
  const group=claims.get(key)??new Set<string>();group.add(o.ownId?'id:'+o.ownId:'observation:'+o.identity);claims.set(key,group);
 }
 const result=new Map<string,RefundEvidenceMatch>();
 for(const o of incoming){
  const set=sets.get(o.recordId!)!;if(!set.size)continue;
  const entries=[...set.entries()],first=entries[0],claim=claims.get(first[0])!;
  // One numbered and one unnumbered observation can coexist; multiple distinct numbered IDs or weak observations cannot claim the same target.
  const strong=[...claim].filter(k=>k.startsWith('id:')),weak=[...claim].filter(k=>k.startsWith('observation:'));
  const automatic=entries.length===1&&first[1].automatic&&strong.length<=1&&weak.length<=1;
  result.set(o.recordId!,{transactionId:automatic?first[1].observation.transactionId:null,recordId:automatic?first[1].observation.recordId:null,candidates:entries.map(([key])=>key),automatic});
 }
 return result;
}
