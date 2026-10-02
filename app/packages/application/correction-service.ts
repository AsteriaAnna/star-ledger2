import type {BusinessCommand,LedgerIntent} from '../domain/accounting.ts';
import type {LedgerSnapshot} from '../accounting/index.ts';
import {applyCommands,correctionSnapshot,interpret} from '../accounting/business.ts';

export type CorrectionRequest={
 transactionId:string;
 replacement:LedgerIntent;
 expectedSnapshot:string;
 sourceId:string;
 correctedAt:string;
};

export type CorrectionPlan={
 commands:BusinessCommand[];
 detachedReturnIds:string[];
 relinkedReturnIds:string[];
 relationReviewIds:string[];
};

const activeLinks=(snapshot:LedgerSnapshot)=>snapshot.entities.filter(e=>e.type==='transaction_links'&&!e.fields.deleted_at);
const tx=(snapshot:LedgerSnapshot,id:string)=>snapshot.entities.find(e=>e.type==='transactions'&&e.id===id&&!e.fields.deleted_at);

function advance(snapshot:LedgerSnapshot,command:BusinessCommand){
 const commands=interpret(command,snapshot);
 return {snapshot:applyCommands(snapshot,commands),commands};
}

function unlinkedReplacement(replacement:LedgerIntent):LedgerIntent{
 if(replacement.kind==='REFUND'||replacement.kind==='RETURN')return {...replacement,originalId:null};
 return replacement;
}

export function planTransactionCorrection(request:CorrectionRequest,snapshot:LedgerSnapshot):CorrectionPlan{
 if(correctionSnapshot(snapshot.entities,request.transactionId)!==request.expectedSnapshot)throw Error('STALE_TRANSACTION');
 const target=tx(snapshot,request.transactionId);if(!target)throw Error('TRANSACTION_UNAVAILABLE');
 if(request.replacement.id!==request.transactionId)throw Error('INVALID_CORRECTION');

 const links=activeLinks(snapshot).filter(link=>link.fields.from_transaction_id===request.transactionId||link.fields.to_transaction_id===request.transactionId);
 const relationRows=links.map(link=>({refundId:String(link.fields.from_transaction_id),originalId:String(link.fields.to_transaction_id)}));
 const detachIds=[...new Set(relationRows.map(row=>row.refundId))];
 const commands:BusinessCommand[]=[];
 let working=snapshot;

 for(const refundId of detachIds){
  const command:BusinessCommand={kind:'UNLINK_RETURN',transactionId:refundId,detachedAt:request.correctedAt};
  const next=advance(working,command);working=next.snapshot;commands.push(command);
 }

 const correction:BusinessCommand={
  kind:'CORRECT_TRANSACTION',transactionId:request.transactionId,
  replacement:unlinkedReplacement(request.replacement),
  expectedSnapshot:correctionSnapshot(working.entities,request.transactionId),
  sourceId:request.sourceId,correctedAt:request.correctedAt
 };
 const corrected=advance(working,correction);working=corrected.snapshot;commands.push(correction);

 const relinked:string[]=[];const review:string[]=[];
 const incoming=relationRows.filter(row=>row.originalId===request.transactionId&&row.refundId!==request.transactionId);
 const outgoing=relationRows.filter(row=>row.refundId===request.transactionId);

 // Incoming returns are a set: if the corrected original cannot support the full set,
 // do not let iteration order decide which financial relation survives.
 if(incoming.length){
  let trial=working;const trialCommands:BusinessCommand[]=[];let valid=true;
  const ordered=[...incoming].sort((a,b)=>{
   const ta=tx(trial,a.refundId),tb=tx(trial,b.refundId);
   return String(ta?.fields.occurred_at||'').localeCompare(String(tb?.fields.occurred_at||''))||a.refundId.localeCompare(b.refundId);
  });
  for(const row of ordered){
   const command:BusinessCommand={kind:'LINK_RETURN',transactionId:row.refundId,originalId:request.transactionId};
   try{trial=advance(trial,command).snapshot;trialCommands.push(command);}catch{valid=false;break;}
  }
  if(valid){working=trial;commands.push(...trialCommands);relinked.push(...ordered.map(row=>row.refundId));}
  else review.push(...incoming.map(row=>row.refundId));
 }

 for(const row of outgoing){
  const correctedTarget=tx(working,request.transactionId);
  if(!correctedTarget||!['REFUND','RETURN'].includes(String(correctedTarget.fields.event_type))){review.push(row.refundId);continue;}
  const command:BusinessCommand={kind:'LINK_RETURN',transactionId:request.transactionId,originalId:row.originalId};
  try{working=advance(working,command).snapshot;commands.push(command);relinked.push(row.refundId);}catch{review.push(row.refundId);}
 }

 return {
  commands,
  detachedReturnIds:detachIds,
  relinkedReturnIds:[...new Set(relinked)],
  relationReviewIds:[...new Set(review)]
 };
}
