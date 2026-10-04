import {returnAllocationContext} from '../accounting/return-context.ts';
import type {Command,LedgerSnapshot} from '../accounting/index.ts';
import {applyCommands,interpret} from '../accounting/business.ts';
import type {Entity} from '../domain/index.ts';
const expectedErrors=new Set(['ORIGINAL_UNAVAILABLE','INVALID_RETURN_KIND','RETURN_BEFORE_ORIGINAL','RETURN_EXCEEDS_ORIGINAL','CONSUMPTION_ALLOCATION_REQUIRED','SPONSORED_REFUND_HAS_OWN_ACCOUNT','REFUND_CONSUMPTION_EXCEEDED','REFUND_NONCONSUMPTION_EXCEEDED']);
const businessError=(error:unknown)=>error instanceof Error&&expectedErrors.has(error.message);
const active=(snapshot:LedgerSnapshot,id:string)=>snapshot.entities.find(e=>e.type==='transactions'&&e.id===id&&!e.fields.deleted_at&&!e.fields.purged_at);
const decisionKey=(id:string)=>`refund-relation:${id}`;
export function relationDecision(snapshot:LedgerSnapshot,id:string):{originalId:string|null;consumptionReduction?:number}|undefined{
 const row=snapshot.entities.find(e=>e.type==='import_rules'&&e.fields.rule_key===decisionKey(id));if(!row)return;
 try{const value=JSON.parse(String(row.fields.value));if(value.version!==1||!(value.originalId===null||typeof value.originalId==='string')||value.consumptionReduction!==undefined&&(!Number.isSafeInteger(value.consumptionReduction)||value.consumptionReduction<0))throw Error();return value;}catch{throw Error('INVALID_RELATION_DECISION');}
}
function relationToken(snapshot:LedgerSnapshot){return JSON.stringify(snapshot.entities.filter(e=>e.type!=='source_records').slice().sort((a,b)=>(a.type+':'+a.id).localeCompare(b.type+':'+b.id)));}
export function refundRelationContext(snapshot:LedgerSnapshot,id:string){
 if(snapshot.conflicts.length)throw Error('UNRESOLVED_CONFLICT');
 const refund=active(snapshot,id);if(!refund||refund.fields.status!=='SUCCESS'||!['REFUND','RETURN'].includes(String(refund.fields.event_type)))throw Error('TRANSACTION_UNAVAILABLE');
 const link=snapshot.entities.find(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.from_transaction_id===id);
 const detached=interpret({kind:'UNLINK_RETURN',transactionId:id,detachedAt:new Date().toISOString()},snapshot);
 const working=applyCommands(snapshot,detached);
 const candidates:Entity[]=[],allocations:Record<string,ReturnType<typeof returnAllocationContext>>={};
 for(const row of snapshot.entities.filter(e=>e.type==='transactions'&&!e.fields.deleted_at&&!e.fields.purged_at&&e.fields.status==='SUCCESS'&&(refund.fields.event_type==='REFUND'?e.fields.event_type==='PURCHASE':['EXTERNAL_TRANSFER','DEPOSIT','RED_PACKET'].includes(String(e.fields.event_type))))){
  try{const allocation=returnAllocationContext(working.entities,id,row.id);interpret({kind:'LINK_RETURN',transactionId:id,originalId:row.id,consumptionReduction:allocation.minimum},working);candidates.push(row);allocations[row.id]=allocation;}catch(error){if(!businessError(error))throw error;}
 }
 candidates.sort((a,b)=>String(b.fields.occurred_at).localeCompare(String(a.fields.occurred_at))||a.id.localeCompare(b.id));
 return {refund,originalId:link?String(link.fields.to_transaction_id):null,candidates,allocations,currentReduction:link?-Number(snapshot.entities.find(e=>e.type==='consumption_effects'&&e.fields.transaction_id===id)?.fields.amount??0):undefined,expectedSnapshot:relationToken(snapshot)};
}
export function planRefundRelation(request:{transactionId:string;originalId:string|null;expectedSnapshot:string;now:string;consumptionReduction?:number},snapshot:LedgerSnapshot):Command[]{
 const context=refundRelationContext(snapshot,request.transactionId);
 if(context.expectedSnapshot!==request.expectedSnapshot)throw Error('STALE_REFUND_RELATION');
 if(request.originalId!==null&&!context.candidates.some(e=>e.id===request.originalId))throw Error('ORIGINAL_UNAVAILABLE');
 let working=snapshot;const commands:Command[]=[];
 const allocation=request.originalId?context.allocations[request.originalId]:undefined;
 const reduction=request.originalId?(request.consumptionReduction??(context.originalId===request.originalId?context.currentReduction:allocation?.reduction)):undefined;
 if(allocation?.requiresAnswer&&reduction===undefined)throw Error('CONSUMPTION_ALLOCATION_REQUIRED');
 if(context.originalId!==request.originalId||request.originalId!==null&&reduction!==context.currentReduction){
  const unlink=interpret({kind:'UNLINK_RETURN',transactionId:request.transactionId,detachedAt:request.now},working);commands.push(...unlink);working=applyCommands(working,unlink);
  if(request.originalId!==null)commands.push(...interpret({kind:'LINK_RETURN',transactionId:request.transactionId,originalId:request.originalId,consumptionReduction:reduction},working));
 }
 const key=decisionKey(request.transactionId),old=snapshot.entities.find(e=>e.type==='import_rules'&&e.fields.rule_key===key),value=JSON.stringify({version:1,originalId:request.originalId,...(reduction!==undefined?{consumptionReduction:reduction}:{})});
 if(old?.fields.value!==value)commands.push({action:old?'PATCH_FIELD':'CREATE_ENTITY',entity:{type:'import_rules',id:old?.id??key,fields:old?{value}:{rule_key:key,value}}});
 return commands;
}
/** Reattach only links detached by this deletion; an explicit user unlink stays unlinked. */
export function planRestoredRefundRelations(before:LedgerSnapshot,restored:LedgerSnapshot,ids:readonly string[]):Command[]{
 const deletedAt=new Map(ids.map(id=>[id,before.entities.find(e=>e.type==='transactions'&&e.id===id)?.fields.deleted_at]));
 const groups=new Map<string,Set<string>>();
 for(const link of restored.entities.filter(e=>e.type==='transaction_links'&&e.fields.deleted_at)){
  const refundId=String(link.fields.from_transaction_id),originalId=String(link.fields.to_transaction_id);
  const legacyActive=ids.includes(refundId)&&before.entities.some(e=>e.type==='transaction_links'&&e.id===link.id&&!e.fields.deleted_at);
  if(!legacyActive&&![refundId,originalId].some(id=>deletedAt.get(id)&&deletedAt.get(id)===link.fields.deleted_at))continue;
  if(!active(restored,refundId)||!active(restored,originalId)||restored.entities.some(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.from_transaction_id===refundId))continue;
  const decision=relationDecision(restored,refundId);if(decision&&decision.originalId!==originalId)continue;
  const historical=new Set(restored.entities.filter(e=>e.type==='transaction_links'&&e.fields.from_transaction_id===refundId&&e.fields.deleted_at===link.fields.deleted_at).map(e=>e.fields.to_transaction_id));
  if(historical.size!==1)continue;
  if(!groups.has(originalId))groups.set(originalId,new Set());groups.get(originalId)!.add(refundId);
 }
 let working=restored;const commands:Command[]=[];
 for(const [originalId,refunds] of groups){let trial=working;const planned:Command[]=[];let valid=true;
  for(const id of [...refunds].sort())try{const next=interpret({kind:'LINK_RETURN',transactionId:id,originalId,consumptionReduction:relationDecision(trial,id)?.consumptionReduction},trial);planned.push(...next);trial=applyCommands(trial,next);}catch(error){if(!businessError(error))throw error;valid=false;break;}
  if(valid){commands.push(...planned);working=trial;}
 }
 return commands;
}
export function relatedTransactions(snapshot:LedgerSnapshot,id:string){
 const links=snapshot.entities.filter(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&(e.fields.from_transaction_id===id||e.fields.to_transaction_id===id));
 return links.map(link=>({direction:link.fields.from_transaction_id===id?'original' as const:'refund' as const,transaction:active(snapshot,String(link.fields.from_transaction_id===id?link.fields.to_transaction_id:link.fields.from_transaction_id))})).filter(row=>row.transaction);
}
