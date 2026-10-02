import type {Entity} from '../domain/index.ts';
import type {LedgerSnapshot} from '../accounting/index.ts';

export function addMoney(values:number[]):number {
 return values.reduce((sum,value)=>{const next=sum+value;if(!Number.isSafeInteger(next))throw Error('MONEY_OVERFLOW');return next;},0);
}
function time(value:string):number {const n=Date.parse(value);if(!Number.isFinite(n))throw Error('INVALID_TIMESTAMP');return n;}
function transaction(snapshot:LedgerSnapshot,id:string):Entity|undefined {
 return snapshot.entities.find(e=>e.type==='transactions'&&e.id===id&&e.fields.deleted_at===null&&e.fields.status==='SUCCESS');
}
function clear(snapshot:LedgerSnapshot):void {
 // Fail closed until UI can show unresolved portions alongside confirmed totals.
 if(snapshot.conflicts.length)throw Error('UNRESOLVED_CONFLICT');
}
export type BalanceResult={accountId:string;balance:number|null;state:'ESTABLISHED'|'UNINITIALIZED'|'DISABLED';
 includedMovements:number;excludedHistoricalMovements:number};

export type BalanceBaseline={balance:number;at:string;source:'OPENING'|'ANCHOR';anchorId:string|null};
function balanceBaseline(snapshot:LedgerSnapshot,account:Entity,end:number):BalanceBaseline|null {
 const anchors=snapshot.entities.filter(e=>e.type==='balance_anchors'&&!e.fields.deleted_at&&e.fields.account_id===account.id&&time(String(e.fields.observed_at))<=end);
 if(anchors.length){
  const latestTime=Math.max(...anchors.map(e=>time(String(e.fields.observed_at))));
  const latest=anchors.filter(e=>time(String(e.fields.observed_at))===latestTime);
  const balances=new Set(latest.map(e=>Number(e.fields.observed_balance)));
  if(balances.size>1)throw Error('AMBIGUOUS_BALANCE_ANCHOR');
  const chosen=[...latest].sort((a,b)=>a.id.localeCompare(b.id))[0];
  return {balance:Number(chosen.fields.observed_balance),at:String(chosen.fields.observed_at),source:'ANCHOR',anchorId:chosen.id};
 }
 if(account.fields.balance_state!=='ESTABLISHED')return null;
 const at=String(account.fields.opening_balance_at);if(time(at)>end)return null;
 return {balance:Number(account.fields.opening_balance),at,source:'OPENING',anchorId:null};
}
function accountMovements(snapshot:LedgerSnapshot,accountId:string,end:number){
 return snapshot.entities.filter(e=>e.type==='balance_movements'&&e.fields.account_id===accountId&&e.fields.amount!==0)
  .map(e=>({movement:e,transaction:transaction(snapshot,String(e.fields.transaction_id))}))
  .filter((x):x is {movement:Entity;transaction:Entity}=>!!x.transaction&&time(String(x.transaction.fields.occurred_at))<=end);
}
export function accountBalance(snapshot:LedgerSnapshot,accountId:string,asOf:string):BalanceResult {
 clear(snapshot);const end=time(asOf);
 const account=snapshot.entities.find(e=>e.type==='accounts'&&e.id===accountId&&!e.fields.deleted_at);
 if(!account)throw Error('ACCOUNT_UNAVAILABLE');
 const base={accountId,balance:null,includedMovements:0,excludedHistoricalMovements:0};
 if(account.fields.balance_tracking==='DISABLED')return {...base,state:'DISABLED'};
 const baseline=balanceBaseline(snapshot,account,end);
 if(!baseline){
  if(account.fields.balance_state==='ESTABLISHED'&&end<time(String(account.fields.opening_balance_at)))throw Error('BEFORE_OPENING_BALANCE');
  return {...base,state:'UNINITIALIZED'};
 }
 const movements=accountMovements(snapshot,accountId,end),start=time(baseline.at);
 const included=movements.filter(x=>time(String(x.transaction.fields.occurred_at))>start);
 return {accountId,state:'ESTABLISHED',balance:addMoney([baseline.balance,...included.map(x=>Number(x.movement.fields.amount))]),
  includedMovements:included.length,excludedHistoricalMovements:movements.length-included.length};
}

export type AccountLedgerRow={transactionId:string;movementId:string;occurredAt:string;amount:number;runningBalance:number;displayName:string};
export type AccountLedger={accountId:string;asOf:string;baseline:BalanceBaseline;rows:AccountLedgerRow[];balance:number};
export function accountLedger(snapshot:LedgerSnapshot,accountId:string,asOf:string):AccountLedger {
 clear(snapshot);const end=time(asOf);
 const account=snapshot.entities.find(e=>e.type==='accounts'&&e.id===accountId&&!e.fields.deleted_at);if(!account)throw Error('ACCOUNT_UNAVAILABLE');
 if(account.fields.balance_tracking==='DISABLED')throw Error('BALANCE_TRACKING_DISABLED');
 const baseline=balanceBaseline(snapshot,account,end);if(!baseline)throw Error('BALANCE_UNINITIALIZED');
 const start=time(baseline.at);
 const movements=accountMovements(snapshot,accountId,end).filter(x=>time(String(x.transaction.fields.occurred_at))>start)
  .sort((a,b)=>time(String(a.transaction.fields.occurred_at))-time(String(b.transaction.fields.occurred_at))||String(a.transaction.id).localeCompare(String(b.transaction.id))||a.movement.id.localeCompare(b.movement.id));
 let running=baseline.balance;
 const rows=movements.map(x=>{running=addMoney([running,Number(x.movement.fields.amount)]);return {transactionId:x.transaction.id,movementId:x.movement.id,occurredAt:String(x.transaction.fields.occurred_at),amount:Number(x.movement.fields.amount),runningBalance:running,displayName:String(x.transaction.fields.display_name)};});
 return {accountId,asOf,baseline,rows,balance:running};
}

export type ReconciliationObservation={accountId:string;observedAt:string;observedBalance:number;ledgerBalance:number;difference:number;ledger:AccountLedger};
export function reconcileAccount(snapshot:LedgerSnapshot,accountId:string,observedBalance:number,observedAt:string):ReconciliationObservation {
 if(!Number.isSafeInteger(observedBalance))throw Error('INVALID_MONEY');
 const ledger=accountLedger(snapshot,accountId,observedAt);
 return {accountId,observedAt,observedBalance,ledgerBalance:ledger.balance,difference:addMoney([observedBalance,-ledger.balance]),ledger};
}
export type ConsumptionContribution={transactionId:string;effectId:string;amount:number;categoryId:string|null;effectiveAt:string;displayName:string};
export function consumptionContributions(snapshot:LedgerSnapshot,startInclusive:string,endExclusive:string):ConsumptionContribution[] {
 clear(snapshot);const start=time(startInclusive),end=time(endExclusive);if(start>=end)throw Error('INVALID_PERIOD');
 return snapshot.entities.filter(e=>e.type==='consumption_effects').map(effect=>({effect,transaction:transaction(snapshot,String(effect.fields.transaction_id))}))
  .filter((x):x is {effect:Entity;transaction:Entity}=>!!x.transaction)
  .filter(x=>{const date=time(String(x.effect.fields.effective_at));return date>=start&&date<end;})
  .map(x=>({transactionId:x.transaction.id,effectId:x.effect.id,amount:Number(x.effect.fields.amount),categoryId:x.effect.fields.category_id===null?null:String(x.effect.fields.category_id),effectiveAt:String(x.effect.fields.effective_at),displayName:String(x.transaction.fields.display_name)}))
  .sort((a,b)=>time(a.effectiveAt)-time(b.effectiveAt)||a.transactionId.localeCompare(b.transactionId)||a.effectId.localeCompare(b.effectId));
}
export function consumptionInPeriod(snapshot:LedgerSnapshot,startInclusive:string,endExclusive:string):number {
 return addMoney(consumptionContributions(snapshot,startInclusive,endExclusive).map(row=>row.amount));
}
export type ConsumptionBreakdownItem={key:string;amount:number;transactionIds:string[]};
export function consumptionByCategory(snapshot:LedgerSnapshot,startInclusive:string,endExclusive:string):ConsumptionBreakdownItem[] {
 const groups=new Map<string,ConsumptionContribution[]>();
 for(const row of consumptionContributions(snapshot,startInclusive,endExclusive)){const key=row.categoryId??'未分类';groups.set(key,[...(groups.get(key)??[]),row]);}
 return [...groups.entries()].map(([key,rows])=>({key,amount:addMoney(rows.map(row=>row.amount)),transactionIds:[...new Set(rows.map(row=>row.transactionId))]}))
  .sort((a,b)=>Math.abs(b.amount)-Math.abs(a.amount)||a.key.localeCompare(b.key));
}
export function consumptionByDay(snapshot:LedgerSnapshot,startInclusive:string,endExclusive:string):ConsumptionBreakdownItem[] {
 const groups=new Map<string,ConsumptionContribution[]>();
 for(const row of consumptionContributions(snapshot,startInclusive,endExclusive)){const key=row.effectiveAt.slice(0,10);groups.set(key,[...(groups.get(key)??[]),row]);}
 return [...groups.entries()].map(([key,rows])=>({key,amount:addMoney(rows.map(row=>row.amount)),transactionIds:[...new Set(rows.map(row=>row.transactionId))]}))
  .sort((a,b)=>a.key.localeCompare(b.key));
}
export function unresolvedMovements(snapshot:LedgerSnapshot):Entity[] {
 clear(snapshot);return snapshot.entities.filter(e=>e.type==='balance_movements'&&e.fields.account_id===null&&e.fields.amount!==0&&transaction(snapshot,e.fields.transaction_id as string));
}
