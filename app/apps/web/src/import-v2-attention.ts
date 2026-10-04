import {AccountingService} from '../../../packages/accounting/index.ts';
import {planImportAccountAnswer,type ImportAccountAnswer} from '../../../packages/application/import-account-attention.ts';
import {mutate,read} from './store.ts';
import {project} from '../../../packages/sync/projection.ts';
import {planImportSourceAnswer,sourceReviewContext,sourceReviewToken,type SourceAnswerMode} from '../../../packages/application/import-source-attention.ts';
import {planImportTransferAnswer,type ImportTransferAnswer} from '../../../packages/application/import-transfer-attention.ts';

export async function answerImportTransfer(input:ImportTransferAnswer){
 await mutate(store=>{
  if(!store.state.importWorkspace)throw Error('STALE_IMPORT_ATTENTION');
  const plan=planImportTransferAnswer(input,store.state.importWorkspace,{entities:store.entities,conflicts:store.conflicts});
  new AccountingService(store,store.state.device).execute(plan.commands);store.state.importWorkspace=plan.workspace;
 });
}

export async function answerImportAccount(input:ImportAccountAnswer){
 let count=0;
 await mutate(store=>{
  if(!store.state.importWorkspace)throw Error('STALE_IMPORT_ATTENTION');
  const plan=planImportAccountAnswer(input,store.state.importWorkspace,{entities:store.entities,conflicts:store.conflicts});
  new AccountingService(store,store.state.device).execute(plan.commands);
  store.state.importWorkspace=plan.workspace;
  count=plan.resolvedCount;
 });
 return count;
}

export async function previewImportSource(sessionId:string,attentionId:string){
 const state=await read(),workspace=state.importWorkspace;if(!workspace)throw Error('STALE_IMPORT_ATTENTION');
 const ledger=project(state.ops),context=sourceReviewContext(sessionId,attentionId,workspace,ledger);
 const options=[];
 for(const mode of ['KEEP_EXISTING','APPLY_SOURCE'] as const){
  try{const plan=await planImportSourceAnswer({sessionId,attentionId,mode,expectedToken:context.token,now:new Date().toISOString()},workspace,ledger);options.push({mode,plan,error:null});}
  catch(error){options.push({mode,plan:null,error:error instanceof Error?error.message:String(error)});}
 }
 return {context,options,accounts:ledger.entities.filter(e=>e.type==='accounts')};
}

export async function answerImportSource(sessionId:string,attentionId:string,mode:SourceAnswerMode,expectedToken:string){
 const state=await read(),workspace=state.importWorkspace;if(!workspace)throw Error('STALE_IMPORT_ATTENTION');
 const ledger=project(state.ops);
 const plan=await planImportSourceAnswer({sessionId,attentionId,mode,expectedToken,now:new Date().toISOString()},workspace,ledger);
 await mutate(store=>{
  if(!store.state.importWorkspace||sourceReviewToken(store.state.importWorkspace,{entities:store.entities,conflicts:store.conflicts})!==expectedToken)throw Error('STALE_SOURCE_REVIEW');
  new AccountingService(store,store.state.device).execute(plan.commands);store.state.importWorkspace=plan.workspace;
 });
 return plan.transactionId;
}
