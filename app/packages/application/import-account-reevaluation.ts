import type {Command,LedgerSnapshot} from '../accounting/index.ts';
import {applyCommands,correctionSnapshot,interpret,pendingPostings} from '../accounting/business.ts';
import {resolveLedgerAccount} from '../importing/account-resolution.ts';
import type {ImportWorkspaceSnapshot} from '../importing/workspace.ts';
import {completeImportSessionFromOutcomes} from './import-execution.ts';

/** Fill only unresolved import legs, using current facts and confirmed scoped identities. */
export function planImportAccountReevaluation(workspace:ImportWorkspaceSnapshot,ledger:LedgerSnapshot,now:string){
 const next=structuredClone(workspace),commands:Command[]=[];let working=ledger,resolvedCount=0;
 for(const [sessionId,items] of Object.entries(next.attention)){
  const resolved=new Set<string>();
  for(const item of items){
   if(item.blocking||!['ACCOUNT','TRANSFER_ENDPOINTS'].includes(item.kind))continue;
   const outcome=next.outcomes[sessionId]?.find(o=>o.externalRecordId===item.externalRecordId);
   const record=next.records[sessionId]?.find(r=>r.id===item.externalRecordId);
   const tx=working.entities.find(e=>e.type==='transactions'&&e.id===outcome?.transactionId&&!e.fields.deleted_at&&!e.fields.purged_at);
   if(!record||outcome?.state!=='COMMITTED'||!tx||!['SUCCESS','PENDING'].includes(String(tx.fields.status)))continue;
   const target=item.kind==='TRANSFER_ENDPOINTS',kind=String(tx.fields.event_type);
   const result=resolveLedgerAccount({eventKind:kind,sourceSystem:record.sourceSystem,platform:record.platformRaw,profile:record.profile,channelRaw:target?record.facts.targetChannelRaw||'':record.facts.channelRaw,role:target?'TARGET':'ACCOUNT',sponsored:/亲情卡|亲属卡/.test(record.facts.channelRaw)},working.entities,working.conflicts);
   if(result.state!=='RESOLVED'||!result.accountId)continue;
   const pending=tx.fields.status==='PENDING',postings=pending?pendingPostings(tx):working.entities;
   const transfer=['REPAYMENT','INTERNAL_TRANSFER','WITHDRAWAL'].includes(kind);
   const moves=postings.filter(e=>e.type==='balance_movements'&&e.fields.transaction_id===tx.id&&Number(e.fields.amount)!==0);
   const legs=moves.filter(m=>{
    if(!transfer)return true;
    const account=working.entities.find(a=>a.type==='accounts'&&a.id===m.fields.account_id);
    const flow=Number(m.fields.amount)*(account?.fields.type==='LIABILITY'?-1:1);
    return target?flow>0:flow<0;
   });
   // Repayment's unknown destination initially has the asset-flow sign; once bound it uses debt sign.
   const leg=legs.length===1?legs[0]:undefined;
   if(!leg)continue;
   if(leg.fields.account_id){if(leg.fields.account_id===result.accountId){resolved.add(item.id);resolvedCount++;}continue;}
   if(transfer&&moves.some(m=>m.id!==leg.id&&m.fields.account_id===result.accountId))continue;
   const command=pending?{kind:'BIND_PENDING_ACCOUNT' as const,transactionId:tx.id,movementId:leg.id,accountId:result.accountId,expectedSnapshot:correctionSnapshot(working.entities,tx.id)}:{kind:'BIND_ACCOUNT' as const,movementId:leg.id,accountId:result.accountId};
   const planned=interpret(command,working);commands.push(...planned);working=applyCommands(working,planned);resolved.add(item.id);resolvedCount++;
  }
  next.attention[sessionId]=items.filter(item=>!resolved.has(item.id));
  if(resolved.size)next.sessions[sessionId]=completeImportSessionFromOutcomes(next.sessions[sessionId],next.outcomes[sessionId]??[],next.attention[sessionId],now);
 }
 return {commands,workspace:next,resolvedCount};
}
