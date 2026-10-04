import type {Entity} from '../domain/index.ts';
import {returnAllocationBounds,resolveReturnAllocation} from '../domain/return-allocation.ts';
export function returnAllocationContext(entities:Entity[],refundId:string,originalId:string){
 const original=entities.find(e=>e.type==='transactions'&&e.id===originalId&&!e.fields.deleted_at&&!e.fields.purged_at),refund=entities.find(e=>e.type==='transactions'&&e.id===refundId&&!e.fields.deleted_at&&!e.fields.purged_at);
 if(!original||!refund)throw Error('ORIGINAL_UNAVAILABLE');
 const others=entities.filter(e=>e.type==='transaction_links'&&!e.fields.deleted_at&&e.fields.to_transaction_id===originalId&&e.fields.from_transaction_id!==refundId).map(e=>entities.find(t=>t.type==='transactions'&&t.id===e.fields.from_transaction_id)).filter((e):e is Entity=>!!e&&!e.fields.deleted_at&&!e.fields.purged_at&&e.fields.status==='SUCCESS');
 const stats={originalAmount:Number(original.fields.display_amount),originalConsumption:Number(entities.find(e=>e.type==='consumption_effects'&&e.fields.transaction_id===originalId)?.fields.amount??0),previousReturned:others.reduce((n,e)=>n+Number(e.fields.display_amount),0),previousReduction:-others.reduce((n,e)=>n+Number(entities.find(effect=>effect.type==='consumption_effects'&&effect.fields.transaction_id===e.id)?.fields.amount??0),0),amount:Number(refund.fields.display_amount)};
 const bounds=returnAllocationBounds(stats),resolved=resolveReturnAllocation(stats);
 return {...stats,...bounds,requiresAnswer:resolved.state==='NEEDS_ALLOCATION',reduction:resolved.state==='RESOLVED'?resolved.reduction:undefined};
}

export function retainedReturnReduction(entities:Entity[],refundId:string,originalId:string){
 const original=entities.find(e=>e.type==='transactions'&&e.id===originalId),effect=entities.find(e=>e.type==='consumption_effects'&&e.fields.transaction_id===originalId);
 const consumed=Number(effect?.fields.amount??0),amount=Number(original?.fields.display_amount??0);
 if(consumed>0&&consumed<amount)return -Number(entities.find(e=>e.type==='consumption_effects'&&e.fields.transaction_id===refundId)?.fields.amount??0);
}
