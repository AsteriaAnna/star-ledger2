import type {Entity} from '../domain/index.ts';
import type {CaptureEvidence,CaptureRecordReference} from './types.ts';
import {validateCaptureReferences} from './capture-evidence.ts';

/** Recover evidence from formal ledger sources, independently of the temporary workspace. */
export function readPersistedCaptureEvidence(entities:Entity[]){
 const byId=new Map<string,CaptureEvidence>();
 const references:{sourceRecordId:string;transactionId:string;capture:CaptureRecordReference}[]=[];
 const missingEvidenceSourceIds:string[]=[];
 for(const source of entities){
  if(source.type!=='source_records')continue;
  let payload:any;
  try{payload=JSON.parse(String(source.fields.raw_payload));}catch{continue;}
  if(!payload||typeof payload!=='object')continue;
  const marked=Object.hasOwn(payload,'captureEvidenceVersion')||Object.hasOwn(payload,'captureEvidence');
  if(!marked){if(payload.capture)missingEvidenceSourceIds.push(source.id);continue;}
  if(payload.version!==3||payload.captureEvidenceVersion!==1||!payload.capture||!payload.captureEvidence)throw Error('INVALID_PERSISTED_CAPTURE_EVIDENCE');
  validateCaptureReferences([{sourceType:source.fields.source_type as 'SCREENSHOT',sourceSystem:payload.sourceSystem,platformRaw:String(source.fields.platform),profile:payload.profile,capture:payload.capture}],[payload.captureEvidence]);
  // The outer reference and the immutable event observation must agree.
  let original:any;try{original=JSON.parse(payload.original);}catch{throw Error('INVALID_PERSISTED_CAPTURE_OBSERVATION');}
  const sameReference=original?.version===1&&['evidenceId','observationId','region','ordinal','sourceClass','identityStrength'].every(key=>original.capture?.[key]===payload.capture[key]);
  if(!sameReference)throw Error('INVALID_PERSISTED_CAPTURE_OBSERVATION');
  const container=payload.captureEvidence as CaptureEvidence,previous=byId.get(container.id);
  if(previous&&previous.capturedAt!==container.capturedAt)throw Error('CAPTURE_EVIDENCE_IMMUTABLE');
  if(!previous)byId.set(container.id,structuredClone(container));
  references.push({sourceRecordId:source.id,transactionId:String(source.fields.transaction_id),capture:structuredClone(payload.capture)});
 }
 return {evidence:[...byId.values()],references,missingEvidenceSourceIds};
}
