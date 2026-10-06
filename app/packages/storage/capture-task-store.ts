import type {DatabaseSync} from 'node:sqlite';
import type {CaptureScope,CaptureTask,CaptureTaskRepository} from '../application/capture-task.ts';
/** K02 reference durable adapter; not installed into the Web/native product. */
export class SqliteCaptureTaskRepository implements CaptureTaskRepository {
 private db:DatabaseSync;
 constructor(db:DatabaseSync){
  this.db=db;
  db.exec('CREATE TABLE IF NOT EXISTS capture_tasks (user_id TEXT NOT NULL,ledger_id TEXT NOT NULL,task_id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(user_id,ledger_id,task_id))');
 }
 async create(task:CaptureTask){
  if(task.version!==0||task.state!=='LOCAL_QUEUED')throw Error('INVALID_CAPTURE_CREATE');
  return Number(this.db.prepare('INSERT OR IGNORE INTO capture_tasks VALUES(?,?,?,?,?)').run(task.userId,task.ledgerId,task.id,task.version,JSON.stringify(task)).changes)===1;
 }
 async get(scope:CaptureScope,id:string){
  const row=this.db.prepare('SELECT payload,version FROM capture_tasks WHERE user_id=? AND ledger_id=? AND task_id=?').get(scope.userId,scope.ledgerId,id);
  if(!row)return null;let task:CaptureTask;
  try{task=JSON.parse(row.payload as string);}catch{throw Error('CORRUPT_CAPTURE_TASK');}
  if(!task||task.userId!==scope.userId||task.ledgerId!==scope.ledgerId||task.id!==id||task.version!==Number(row.version))throw Error('CORRUPT_CAPTURE_TASK');
  return task;
 }
 async list(scope:CaptureScope){
  const rows=this.db.prepare('SELECT task_id FROM capture_tasks WHERE user_id=? AND ledger_id=? ORDER BY task_id').all(scope.userId,scope.ledgerId);
  const tasks=await Promise.all(rows.map(row=>this.get(scope,String(row.task_id))));
  return tasks.filter((task):task is CaptureTask=>task!==null);
 }
 private check(scope:CaptureScope,id:string,version:number,next:CaptureTask){
  if(next.userId!==scope.userId||next.ledgerId!==scope.ledgerId||next.id!==id||next.version!==version+1)throw Error('INVALID_CAPTURE_REPLACEMENT');
 }
 async replace(scope:CaptureScope,id:string,version:number,next:CaptureTask){
  this.check(scope,id,version,next);
  if(next.state==='COMPLETED'){
   const current=await this.get(scope,id);
   if(current?.state!=='COMPLETED')throw Error('CAPTURE_ATOMIC_COMMIT_REQUIRED');
  }
  return this.cas(scope,id,version,next);
 }
 private cas(scope:CaptureScope,id:string,version:number,next:CaptureTask){
  return Number(this.db.prepare('UPDATE capture_tasks SET version=?,payload=? WHERE user_id=? AND ledger_id=? AND task_id=? AND version=?').run(next.version,JSON.stringify(next),scope.userId,scope.ledgerId,id,version).changes)===1;
 }
 async complete(scope:CaptureScope,id:string,version:number,next:CaptureTask,writeLedgerAndOutcomes:()=>void){
  this.check(scope,id,version,next);if(next.state!=='COMPLETED'||!next.receipt)throw Error('INVALID_CAPTURE_COMPLETION');
  if(writeLedgerAndOutcomes.constructor.name==='AsyncFunction')throw Error('CAPTURE_ASYNC_COMMIT_FORBIDDEN');
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(!this.cas(scope,id,version,next)){this.db.exec('ROLLBACK');return false;}
   const callback:unknown=writeLedgerAndOutcomes();
   if(callback&&typeof (callback as {then?:unknown}).then==='function')throw Error('CAPTURE_ASYNC_COMMIT_FORBIDDEN');
   this.db.exec('COMMIT');return true;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
}
