import type {CaptureEvidence,CaptureRecordReference,ExternalRecord,NormalizedSourceFacts} from './types.ts';
import {importIdentityHash,strongSourceEventIdentity} from './source-event-identity.ts';
export type CaptureObservation={role:'EVENT'|'SUMMARY';key:string;region:string;ordinal:number;sourceClass:'payment'|'refund';facts:NormalizedSourceFacts};
const validText=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=256&&v.trim()===v;
const evidenceId=(e:Omit<CaptureEvidence,'id'>)=>'capture-evidence:'+importIdentityHash({contentHash:e.contentHash,responseHash:e.responseHash,schemaVersion:e.schemaVersion,promptVersion:e.promptVersion,model:e.model,pageKind:e.pageKind,sourceSystem:e.sourceSystem,platformRaw:e.platformRaw,profile:e.profile,rawExtraction:e.rawExtraction});
export function validateCaptureEvidence(e:CaptureEvidence){
 if(!e||![e.id,e.contentHash,e.responseHash,e.schemaVersion,e.promptVersion,e.model,e.profile,e.capturedAt].every(validText)||!['WECHAT','ALIPAY'].includes(e.sourceSystem)||e.platformRaw!==(e.sourceSystem==='WECHAT'?'微信':'支付宝')||!['payment_detail','ledger_record','unknown'].includes(e.pageKind)||typeof e.rawExtraction!=='string'||!Number.isFinite(Date.parse(e.capturedAt)))throw Error('INVALID_CAPTURE_EVIDENCE');
 if(e.responseHash!==importIdentityHash(e.rawExtraction))throw Error('CAPTURE_EXTRACTION_HASH_MISMATCH');
 if(e.id!==evidenceId(e))throw Error('CAPTURE_EVIDENCE_ID_MISMATCH');
}
export function captureEvidence(input:Omit<CaptureEvidence,'id'|'responseHash'>):CaptureEvidence{
 const body={...input,responseHash:importIdentityHash(input.rawExtraction)};
 const value={...body,id:evidenceId(body)};validateCaptureEvidence(value);return value;
}
/** Facts are already validated observations, not raw model candidates. No accounting commands. */
export function captureEventRecords(evidence:CaptureEvidence,sessionId:string,observations:CaptureObservation[],parserVersion:number):ExternalRecord[]{
 validateCaptureEvidence(evidence);
 if(evidence.pageKind!=='payment_detail')throw Error('CAPTURE_NOT_PAYMENT_EVIDENCE');
 if(!validText(sessionId)||!Number.isSafeInteger(parserVersion)||parserVersion<1||!observations.length)throw Error('INVALID_CAPTURE_RECORDS');
 const seen=new Set<string>(),identities=new Set<string>();
 if(observations.some(o=>!['EVENT','SUMMARY'].includes(o.role)))throw Error('INVALID_CAPTURE_OBSERVATION_ROLE');
 return observations.filter(o=>o.role==='EVENT').map(observation=>{
  const {key,region,ordinal,sourceClass}=observation;
  if(!validText(key)||!validText(region)||!Number.isSafeInteger(ordinal)||ordinal<0||!['payment','refund'].includes(sourceClass)||seen.has(key))throw Error('INVALID_CAPTURE_OBSERVATION');seen.add(key);
  const facts=structuredClone(observation.facts);
  if(!facts||(facts.amountFen!==null&&(!Number.isSafeInteger(facts.amountFen)||facts.amountFen<0)))throw Error('INVALID_CAPTURE_MONEY');
  const ownId=sourceClass==='refund'?facts.refundId:facts.orderId;
  if(ownId!==null&&!validText(ownId))throw Error('INVALID_CAPTURE_EVENT_ID');
  // A refund may display the original payment ID; keep it only as a relationship.
  if(sourceClass==='refund'){
   if(facts.orderId&&facts.orderId!==facts.refundId){
    if(facts.originalOrderId&&facts.originalOrderId!==facts.orderId)throw Error('CAPTURE_ORIGINAL_ORDER_CONFLICT');
    facts.originalOrderId=facts.orderId;
   }
   facts.orderId=ownId;
  }
  const observationId='capture-observation:'+importIdentityHash({system:evidence.sourceSystem,profile:evidence.profile,contentHash:evidence.contentHash,key,sourceClass});
  const sourceIdentity=ownId?strongSourceEventIdentity(evidence.platformRaw,evidence.profile,sourceClass,ownId):observationId;
  if(identities.has(sourceIdentity))throw Error('DUPLICATE_CAPTURE_EVENT_IDENTITY');identities.add(sourceIdentity);
  const capture:CaptureRecordReference={evidenceId:evidence.id,observationId,region,ordinal,sourceClass,identityStrength:ownId?'STRONG':'OBSERVATION'};
  return {id:'capture-record:'+importIdentityHash({sessionId,observationId}),sessionId,sourceIdentity,sourceType:'SCREENSHOT',sourceSystem:evidence.sourceSystem,platformRaw:evidence.platformRaw,profile:evidence.profile,
   rawPayload:JSON.stringify({version:1,capture,facts}),facts,parserVersion,capturedAt:evidence.capturedAt,capture};
 });
}
export function validateCaptureReferences(records:Pick<ExternalRecord,'sourceType'|'sourceSystem'|'platformRaw'|'profile'|'capture'>[],evidence:CaptureEvidence[]){
 const byId=new Map<string,CaptureEvidence>();
 for(const item of evidence){validateCaptureEvidence(item);if(byId.has(item.id))throw Error('DUPLICATE_CAPTURE_EVIDENCE');byId.set(item.id,item);}
 for(const record of records){
  if(!record.capture)continue;
  const c=record.capture,e=byId.get(c.evidenceId);
  if(!e||record.sourceType!=='SCREENSHOT'||record.sourceSystem!==e.sourceSystem||record.platformRaw!==e.platformRaw||record.profile!==e.profile||!validText(c.observationId)||!validText(c.region)||!Number.isSafeInteger(c.ordinal)||c.ordinal<0||!['payment','refund'].includes(c.sourceClass)||!['STRONG','OBSERVATION'].includes(c.identityStrength))throw Error('INVALID_CAPTURE_REFERENCE');
 }
}
/** Extraction versions are immutable; event results continue using the existing one-record/one-outcome model. */
export function mergeCaptureEvidence(existing:CaptureEvidence[],incoming:CaptureEvidence[]){
 const out=new Map<string,CaptureEvidence>();
 for(const item of existing){validateCaptureEvidence(item);if(out.has(item.id))throw Error('DUPLICATE_CAPTURE_EVIDENCE');out.set(item.id,item);}
 for(const item of incoming){validateCaptureEvidence(item);const old=out.get(item.id);
  if(old&&old.capturedAt!==item.capturedAt)throw Error('CAPTURE_EVIDENCE_IMMUTABLE');out.set(item.id,structuredClone(item));
 }
 return [...out.values()];
}
