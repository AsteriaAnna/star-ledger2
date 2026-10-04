import type {LedgerSnapshot} from '../accounting/index.ts';
import {addMoney,consumptionContributions} from './index.ts';
export type PeriodMode='MONTH'|'YEAR'|'WEEK'|'QUARTER'|'CUSTOM';
export type DatePeriod={start:string;end:string}; // inclusive Beijing calendar dates
const dayMs=86400000,offset=8*3600000;
export function calendarDay(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('INVALID_PERIOD');
 const n=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==value)throw Error('INVALID_PERIOD');return n;
}
export const dateOf=(n:number)=>new Date(n).toISOString().slice(0,10);
export const nextDay=(value:string,days=1)=>dateOf(calendarDay(value)+days*dayMs);
export function periodBounds(period:DatePeriod):[string,string]{
 const start=calendarDay(period.start),end=calendarDay(period.end);if(start>end)throw Error('INVALID_PERIOD');
 return [new Date(start-offset).toISOString(),new Date(end+dayMs-offset).toISOString()];
}
export function selectPeriod(mode:PeriodMode,anchor:string,custom?:DatePeriod):DatePeriod{
 const n=calendarDay(anchor),date=new Date(n),y=date.getUTCFullYear(),m=date.getUTCMonth();
 if(mode==='CUSTOM'){if(!custom)throw Error('INVALID_PERIOD');periodBounds(custom);return {...custom};}
 if(mode==='YEAR')return {start:`${y}-01-01`,end:`${y}-12-31`};
 if(mode==='WEEK'){const monday=n-((date.getUTCDay()+6)%7)*dayMs;return {start:dateOf(monday),end:dateOf(monday+6*dayMs)};}
 return {start:dateOf(Date.UTC(y,m-(mode==='QUARTER'?2:0),1)),end:dateOf(Date.UTC(y,m+1,1)-dayMs)};
}
export function previousPeriod(period:DatePeriod,mode:PeriodMode):DatePeriod{
 periodBounds(period);const date=new Date(calendarDay(period.start)),y=date.getUTCFullYear(),m=date.getUTCMonth();
 if(mode==='MONTH'||mode==='QUARTER'){const months=mode==='MONTH'?1:3;return {start:dateOf(Date.UTC(y,m-months,1)),end:dateOf(Date.UTC(y,m,1)-dayMs)};}
 if(mode==='YEAR')return {start:`${y-1}-01-01`,end:`${y-1}-12-31`};
 const count=(calendarDay(period.end)-calendarDay(period.start))/dayMs+1;
 return {start:nextDay(period.start,-count),end:nextDay(period.start,-1)};
}
/** One monthly budget; fractions are summed before rounding to cents. */
export function budgetForPeriod(monthly:number|null,period:DatePeriod):number|null{
 periodBounds(period);if(monthly===null)return null;if(!Number.isSafeInteger(monthly)||monthly<0)throw Error('INVALID_MONEY');
 const finish=calendarDay(period.end);let cursor=calendarDay(period.start),sum=0;
 while(cursor<=finish){const date=new Date(cursor),y=date.getUTCFullYear(),m=date.getUTCMonth(),next=Date.UTC(y,m+1,1),days=(next-Date.UTC(y,m,1))/dayMs,until=Math.min(finish+dayMs,next);sum+=monthly*((until-cursor)/dayMs)/days;cursor=until;}
 const amount=Math.round(sum);if(!Number.isSafeInteger(amount))throw Error('MONEY_OVERFLOW');return amount;
}
export function periodConsumption(snapshot:LedgerSnapshot,period:DatePeriod){
 const rows=consumptionContributions(snapshot,...periodBounds(period)),spending=addMoney(rows.filter(r=>r.amount>0).map(r=>r.amount)),refunds=-addMoney(rows.filter(r=>r.amount<0).map(r=>r.amount));
 return {spending,refunds,net:addMoney([spending,-refunds]),count:new Set(rows.filter(r=>r.amount>0).map(r=>r.transactionId)).size};
}
export function consumptionChange(current:number,previous:number){
 return {difference:addMoney([current,-previous]),percent:previous>0&&current>=0?(current-previous)/previous*100:null};
}
export function consumptionTrend(snapshot:LedgerSnapshot,period:DatePeriod){
 const rows=consumptionContributions(snapshot,...periodBounds(period)),monthly=(calendarDay(period.end)-calendarDay(period.start))/dayMs>=45;
 const totals=new Map<string,number>();for(const row of rows){const date=dateOf(Date.parse(row.effectiveAt)+offset),key=monthly?date.slice(0,7):date;totals.set(key,addMoney([totals.get(key)||0,row.amount]));}
 const keys:string[]=[];let cursor=calendarDay(period.start),end=calendarDay(period.end);
 while(cursor<=end){const day=dateOf(cursor),key=monthly?day.slice(0,7):day;keys.push(key);const date=new Date(cursor);cursor=monthly?Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1):cursor+dayMs;}
 return keys.map(key=>({key,amount:totals.get(key)||0}));
}
export function majorBills(snapshot:LedgerSnapshot,period:DatePeriod,limit=5){
 const rows=consumptionContributions(snapshot,...periodBounds(period));
 const totals=new Map<string,number>();for(const row of rows)if(row.amount>0)totals.set(row.transactionId,addMoney([totals.get(row.transactionId)||0,row.amount]));
 return snapshot.entities.filter(e=>e.type==='transactions'&&e.fields.event_type!=='WITHDRAWAL'&&totals.has(e.id)).sort((a,b)=>totals.get(b.id)!-totals.get(a.id)!||String(b.fields.occurred_at).localeCompare(String(a.fields.occurred_at))||a.id.localeCompare(b.id)).slice(0,limit);
}
