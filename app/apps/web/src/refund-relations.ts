import {AccountingService} from '../../../packages/accounting/index.ts';
import {planRefundRelation} from '../../../packages/application/refund-relations.ts';
import {mutate} from './store.ts';
export async function saveRefundRelation(request:Parameters<typeof planRefundRelation>[0]){
 await mutate(store=>new AccountingService(store,store.state.device).execute(snapshot=>planRefundRelation(request,snapshot)));
}
