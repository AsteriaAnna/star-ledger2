import {planForgetAccountMemory} from '../../../packages/application/account-memory.ts';
import {AccountingService} from '../../../packages/accounting/index.ts';
import {mutate} from './store.ts';

export async function forgetAccountMemory(input:Parameters<typeof planForgetAccountMemory>[0]){
 await mutate(store=>{new AccountingService(store,store.state.device).execute(snapshot=>planForgetAccountMemory(input,snapshot));});
}
