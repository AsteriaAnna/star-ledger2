import {AccountingService} from '../../../packages/accounting/index.ts';
import {planDetailEdit,type DetailEditRequest} from '../../../packages/application/transaction-edit.ts';
import {mutate} from './store.ts';
export async function saveDetailEdit(request:DetailEditRequest){
 await mutate(store=>{
  const commands=planDetailEdit(request,{entities:store.entities,conflicts:store.conflicts});
  if(commands.length)new AccountingService(store,store.state.device).execute(commands);
 });
}
