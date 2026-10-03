/** Diagnostic, not a regression test: reports violated expectations without blessing bugs.
 * Run: node scripts/audit-m5-lifecycle.ts (from app/). Synthetic data only.
 * Exit 0 means diagnostic completed; inspect each `violation`, not the exit code.
 */
import {pathToFileURL} from 'node:url';
import {applyCommands,correctionSnapshot,interpret} from '../packages/accounting/business.ts';
import type {LedgerSnapshot} from '../packages/accounting/index.ts';
import type {BusinessCommand} from '../packages/domain/accounting.ts';
import {ImportStatementService} from '../packages/application/import-service.ts';
import {planImportCommit} from '../packages/application/import-commit.ts';
import {planImportExecution} from '../packages/application/import-execution.ts';
import {planTransactionCorrection} from '../packages/application/correction-service.ts';
import {InMemoryImportWorkspace} from '../packages/importing/workspace.ts';
import type {ExternalRecord,EventInterpretation} from '../packages/importing/types.ts';

const at='2026-10-03T00:00:00Z';
const record=(id:string,rawPayload='v1',sourceIdentity=id):ExternalRecord=>({id,sessionId:'audit',sourceIdentity,sourceType:'EXCEL',sourceSystem:'ALIPAY',platformRaw:'支付宝',profile:'synthetic',rawPayload,parserVersion:3,capturedAt:at,facts:{occurredAt:at,amountFen:1000,transactionTypeRaw:'消费',directionRaw:'支出',statusRaw:'交易成功',channelRaw:'',counterpartyRaw:'合成商户',productRaw:'商品',noteRaw:'source-note',sourceCategoryRaw:'',orderId:sourceIdentity,refundId:null,originalOrderId:null,precision:'second'}});
const meaning=(id:string,patch:Partial<EventInterpretation>={}):EventInterpretation=>({externalRecordId:id,eventKind:'PURCHASE',status:'SUCCESS',amountFen:1000,occurredAt:at,displayName:'合成商品',channelRaw:'',categorySuggestion:'购物',evidence:[],...patch});
function harness(){
 let ledger:LedgerSnapshot={entities:[],conflicts:[]};
 const workspace=new InMemoryImportWorkspace(),service=new ImportStatementService(workspace);
 const execute=(commands:BusinessCommand[])=>{let next=ledger;for(const c of commands)next=applyCommands(next,interpret(c,next));ledger=next;};
 const prepare=(records:ExternalRecord[],interpretations:EventInterpretation[])=>service.prepare({sessionId:'audit',sourceType:'EXCEL',sourceSystem:'ALIPAY',records,interpretations,ledger,now:at});
 const resolve=async(records:ExternalRecord[],interpretations:EventInterpretation[])=>service.resolve({prepared:await prepare(records,interpretations),records,ledger,now:at});
 const commit=async(records:ExternalRecord[],interpretations:EventInterpretation[])=>{const resolved=await resolve(records,interpretations);const plan=planImportCommit(resolved,records);const execution=planImportExecution(plan,ledger,at);execute(execution.commands);return {resolved,plan,execution};};
 return {workspace,prepare,resolve,commit,execute,snapshot:()=>ledger};
}
export async function runLifecycleAudit(){
const findings=[];
{
 const h=harness(),r=record('revive'),first=await h.commit([r],[meaning(r.id)]),id=first.execution.createdIds[0];
 const replacement={kind:'PURCHASE' as const,id,name:'user-name',amount:1200,occurredAt:at,payer:null,categoryId:'用户分类',funding:'OWN' as const,note:'user-note'};
 h.execute(planTransactionCorrection({transactionId:id,replacement,expectedSnapshot:correctionSnapshot(h.snapshot().entities,id),correctedAt:at},h.snapshot()).commands);
 h.execute([{kind:'DELETE_TRANSACTION',transactionId:id,deletedAt:at}]);
 const result=await h.commit([r],[meaning(r.id)]),tx=h.snapshot().entities.find(e=>e.type==='transactions'&&e.id===id)!;
 findings.push({id:'REVIVE_OVERWRITES_CORRECTION',disposition:result.resolved.records[0].disposition,expected:{amount:1200,note:'user-note'},observed:{amount:tx.fields.display_amount,note:tx.fields.note},violation:tx.fields.display_amount!==1200||tx.fields.note!=='user-note'});
}
{
 const h=harness(),r=record('evidence');await h.commit([r],[meaning(r.id)]);
 const changed={...r,rawPayload:'v2',facts:{...r.facts,amountFen:2000}},m=meaning(r.id,{amountFen:2000});
 const update=await h.commit([changed],[m]);const before=(await h.workspace.listAttentionItems('audit')).length;
 const retry=await h.prepare([changed],[m]);const after=(await h.workspace.listAttentionItems('audit')).length;
 const amount=h.snapshot().entities.find(e=>e.type==='transactions')!.fields.display_amount;
 findings.push({id:'UNANSWERED_SOURCE_UPDATE_LOST_ON_RETRY',firstDisposition:update.resolved.records[0].disposition,retryDisposition:retry.records[0].disposition,beforeAttention:before,afterAttention:after,ledgerAmount:amount,sourceAmount:2000,expected:'unanswered source update remains actionable',violation:before>0&&after===0&&amount===1000});
}
{
 const h=harness(),failed=record('failed','failed','same-order'),success=record('success','success','same-order'),unrelated=record('unrelated');
 const rows=[failed,success,unrelated],meanings=[meaning(failed.id,{status:'FAILED'}),meaning(success.id),meaning(unrelated.id)];
 const result=await h.resolve(rows,meanings);let error:string|null=null;
 try{h.execute(planImportExecution(planImportCommit(result,rows),h.snapshot(),at).commands);}catch(e){error=String(e);}
 findings.push({id:'FAILED_PREDECESSOR_BREAKS_BATCH',dispositions:result.records.map(r=>r.disposition),error,transactionCount:h.snapshot().entities.filter(e=>e.type==='transactions').length,expected:'valid successor and unrelated row can be handled without missing-target error',violation:error!==null});
}
return {originalFailureBaseline:'66fd47bc09bb85f4f3a57aa0082f6e1fd56a800e',scope:'application services and accounting interpreter; synthetic data; no browser or storage failure injection',findings};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await runLifecycleAudit(),null,2));
