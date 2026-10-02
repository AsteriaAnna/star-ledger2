import {AccountingService} from '../../../packages/accounting/index.ts';
import {planImportAccountAnswer,type ImportAccountAnswer} from '../../../packages/application/import-account-attention.ts';
import {mutate} from './store.ts';

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
