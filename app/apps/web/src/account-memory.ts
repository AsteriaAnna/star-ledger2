import {planForgetAccountMemory,planSetAccountAlias} from '../../../packages/application/account-memory.ts';
import {planImportAccountReevaluation} from '../../../packages/application/import-account-reevaluation.ts';
import {AccountingService} from '../../../packages/accounting/index.ts';
import {mutate} from './store.ts';

export async function forgetAccountMemory(input:Parameters<typeof planForgetAccountMemory>[0]){
 await mutate(store=>{new AccountingService(store,store.state.device).execute(snapshot=>planForgetAccountMemory(input,snapshot));});
}

export async function setAccountAlias(input:Parameters<typeof planSetAccountAlias>[0]){
 await mutate(store=>{
  new AccountingService(store,store.state.device).execute(snapshot=>planSetAccountAlias(input,snapshot));
  if(store.state.importWorkspace){const plan=planImportAccountReevaluation(store.state.importWorkspace,{entities:store.entities,conflicts:store.conflicts},input.now);if(plan.commands.length)new AccountingService(store,store.state.device).execute(plan.commands);store.state.importWorkspace=plan.workspace;}
 });
}
