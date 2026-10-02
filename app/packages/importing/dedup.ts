import type {Entity} from '../domain/index.ts';

export type SourceIdentity={value:string;platform:string;profile:string;orderId?:string|null};

export type SourceMatch={
 transactionIds:string[];
 activeTransactionIds:string[];
 deletedTransactionIds:string[];
 matchedBy:('RULE'|'SOURCE_IDENTITY'|'LEGACY_SOURCE_ID'|'LEGACY_ORDER')[];
};

const json=(value:unknown):any=>{try{return JSON.parse(String(value));}catch{return undefined;}};

export function findSourceMatch(identity:SourceIdentity,entities:Entity[]):SourceMatch{
 const ids=new Set<string>(),matchedBy=new Set<SourceMatch['matchedBy'][number]>();
 const rule=identity.profile==='本人'?entities.find(e=>e.type==='import_rules'&&e.id==='source-'+identity.value):undefined;
 const linked=json(rule?.fields.value);
 if(linked?.transactionId){ids.add(String(linked.transactionId));matchedBy.add('RULE');}
 for(const source of entities.filter(e=>e.type==='source_records')){
  const payload=json(source.fields.raw_payload);if(!payload)continue;
  if(payload.identity===identity.value&&source.fields.platform===identity.platform&&(payload.profile?payload.profile===identity.profile:identity.profile==='本人')){ids.add(String(source.fields.transaction_id));matchedBy.add('SOURCE_IDENTITY');continue;}
  if(identity.profile==='本人'&&source.id==='source-'+identity.value){ids.add(String(source.fields.transaction_id));matchedBy.add('LEGACY_SOURCE_ID');continue;}
  if(identity.orderId&&payload.order===identity.orderId&&source.fields.platform===identity.platform&&(payload.profile?payload.profile===identity.profile:identity.profile==='本人')){
   ids.add(String(source.fields.transaction_id));matchedBy.add('LEGACY_ORDER');
  }
 }
 const transactions=entities.filter(e=>e.type==='transactions'&&ids.has(e.id)&&!e.fields.purged_at);
 return {
  transactionIds:transactions.map(t=>t.id),
  activeTransactionIds:transactions.filter(t=>!t.fields.deleted_at).map(t=>t.id),
  deletedTransactionIds:transactions.filter(t=>!!t.fields.deleted_at).map(t=>t.id),
  matchedBy:[...matchedBy]
 };
}
