'use strict';
// Server-only SQL transport. Manager SDK executePGSql is injected with invocation credentials.
// Never install into the browser. This adapter has no accounting/ledger completion authority.
const token=v=>{if(typeof v!=='string'||!v.length||v.length>256||v.trim()!==v)throw Error('INVALID_CAPTURE_SCOPE');return v;};
const literal=v=>"convert_from(decode('"+Buffer.from(v,'utf8').toString('hex')+"','hex'),'UTF8')";
const json=v=>literal(JSON.stringify(v))+'::jsonb';
const scopeWhere=s=>`user_id=${literal(token(s.userId))} AND ledger_id=${literal(token(s.ledgerId))}`;
function taskValid(t){
 if(!t||![t.userId,t.ledgerId,t.id,t.contentHash,t.requestVersion].every(v=>{token(v);return true;})||!Number.isSafeInteger(t.version)||t.version<0||!['LOCAL_QUEUED','UPLOADING','ACCEPTED','ANALYZING','RECONCILING','READY','NEEDS_INPUT','RETRYABLE_FAILURE','CANCELLED','EXPIRED'].includes(t.state)||!Number.isSafeInteger(t.createdAt)||!Number.isSafeInteger(t.updatedAt)||!Number.isSafeInteger(t.expiresAt)||t.expiresAt<=t.createdAt||t.receipt!==null)throw Error('INVALID_REMOTE_CAPTURE_TASK');
}
function rows(r){
 if(!r||!Array.isArray(r.Columns)||(r.Rows!==null&&!Array.isArray(r.Rows))||r.Columns.length!==1||r.Columns[0]!=='payload')throw Error('INVALID_CAPTURE_SQL_RESULT');
 return (r.Rows??[]).map(row=>{let values;try{values=JSON.parse(row);}catch{throw Error('INVALID_CAPTURE_SQL_ROW');}if(!Array.isArray(values)||values.length!==1||typeof values[0]!=='string')throw Error('INVALID_CAPTURE_SQL_ROW');try{return JSON.parse(values[0]);}catch{throw Error('INVALID_CAPTURE_SQL_PAYLOAD');}});
}
function expectedTask(s,id,v,next){taskValid(next);if(next.userId!==s.userId||next.ledgerId!==s.ledgerId||next.id!==id||next.version!==v+1||!Number.isSafeInteger(v)||v<0)throw Error('INVALID_CAPTURE_REPLACEMENT');}
class CapturePostgresRepository {
 constructor(executePGSql){if(typeof executePGSql!=='function')throw Error('CAPTURE_SQL_TRANSPORT_REQUIRED');this.executePGSql=executePGSql;}
 async query(Sql){return rows(await this.executePGSql({Sql,Role:'service_role'}));}
 // ExecutePGSql commits DML but omits RETURNING rows. Success is its affected-row count.
 async write(Sql){const r=await this.executePGSql({Sql,Role:'service_role'});if(!r||!Number.isSafeInteger(r.AffectedRows)||![0,1].includes(r.AffectedRows))throw Error('INVALID_CAPTURE_SQL_AFFECTED_ROWS');return r.AffectedRows===1;}
 async create(task){
  taskValid(task);if(task.version!==0||task.state!=='LOCAL_QUEUED'||task.result!==null)throw Error('INVALID_CAPTURE_CREATE');
  return this.write(`INSERT INTO public.star_ledger_capture_task (user_id,ledger_id,task_id,version,payload) VALUES (${literal(task.userId)},${literal(task.ledgerId)},${literal(task.id)},0,${json(task)}) ON CONFLICT DO NOTHING`);
 }
 async get(scope,id){const r=await this.query(`SELECT payload FROM public.star_ledger_capture_task WHERE ${scopeWhere(scope)} AND task_id=${literal(token(id))}`);if(r.length>1)throw Error('INVALID_CAPTURE_SQL_RESULT');if(!r.length)return null;taskValid(r[0]);if(r[0].userId!==scope.userId||r[0].ledgerId!==scope.ledgerId||r[0].id!==id)throw Error('CAPTURE_SCOPE_MISMATCH');return r[0];}
 async replace(scope,id,version,next){
  expectedTask(scope,id,version,next);
  return this.write(`UPDATE public.star_ledger_capture_task SET version=${next.version},payload=${json(next)} WHERE ${scopeWhere(scope)} AND task_id=${literal(token(id))} AND version=${version} AND payload->'result' IS NOT DISTINCT FROM ${json(next.result)} AND payload->>'contentHash'=${literal(next.contentHash)} AND payload->>'requestVersion'=${literal(next.requestVersion)}`);
 }
 /** Result acceptance is a single SQL statement: version-fenced task and immutable extraction together. */
 async publish(scope,id,version,next,evidence){
  expectedTask(scope,id,version,next);
  if(next.state!=='READY'||!next.result||next.result.id!==evidence.id||next.result.responseHash!==evidence.responseHash||next.result.schemaVersion!==evidence.schemaVersion||next.result.promptVersion!==evidence.promptVersion||next.contentHash!==evidence.contentHash)throw Error('CAPTURE_RESULT_MISMATCH');
  // Evidence hash/shape must be validated by the shared captureEvidence adapter before calling.
  const immutable=`NOT EXISTS (SELECT 1 FROM public.star_ledger_capture_result WHERE ${scopeWhere(scope)} AND task_id=${literal(id)} AND result_id=${literal(evidence.id)} AND evidence IS DISTINCT FROM ${json(evidence)})`;
  const r=await this.query(`WITH accepted AS (
 UPDATE public.star_ledger_capture_task SET version=${next.version},payload=${json(next)}
 WHERE ${scopeWhere(scope)} AND task_id=${literal(token(id))} AND version=${version}
 AND payload->>'state' IN ('ANALYZING','RECONCILING') AND payload->>'contentHash'=${literal(next.contentHash)} AND payload->>'requestVersion'=${literal(next.requestVersion)} AND ${immutable} RETURNING payload
 ), saved AS (
 INSERT INTO public.star_ledger_capture_result (user_id,ledger_id,task_id,result_id,response_hash,evidence)
 SELECT ${literal(scope.userId)},${literal(scope.ledgerId)},${literal(id)},${literal(evidence.id)},${literal(evidence.responseHash)},${json(evidence)} FROM accepted
 ON CONFLICT DO NOTHING RETURNING result_id
 ) SELECT payload FROM accepted`);return r.length===1;
 }
 async result(scope,id,resultId){
  const r=await this.query(`SELECT evidence AS payload FROM public.star_ledger_capture_result WHERE ${scopeWhere(scope)} AND task_id=${literal(token(id))} AND result_id=${literal(token(resultId))}`);
  if(r.length>1)throw Error('INVALID_CAPTURE_SQL_RESULT');return r[0]??null;
 }
 async complete(){throw Error('REMOTE_CAPTURE_CANNOT_COMMIT_LOCAL_LEDGER');}
}
module.exports={CapturePostgresRepository};
