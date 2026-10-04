import {AccountingService} from '../../../packages/accounting/index.ts';
import {planTransactionLifecycle,type LifecycleRequest} from '../../../packages/application/transaction-lifecycle.ts';
import {mutate} from './store.ts';
export async function saveTransactionLifecycle(request:LifecycleRequest){
 await mutate(store=>new AccountingService(store,store.state.device).execute(snapshot=>planTransactionLifecycle(request,snapshot)));
}
export async function saveBatchCategory(request:Parameters<typeof planBatchCategory>[0]){
 await mutate(store=>new AccountingService(store,store.state.device).execute(snapshot=>planBatchCategory(request,snapshot)));
}
import {planBatchCategory} from '../../../packages/application/batch-category.ts';
