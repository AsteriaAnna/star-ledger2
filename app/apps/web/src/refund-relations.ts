import {refreshRefundAttention} from '../../../packages/application/late-refund-relations.ts';
import {AccountingService} from '../../../packages/accounting/index.ts';
import {planRefundRelation} from '../../../packages/application/refund-relations.ts';
import {mutate} from './store.ts';
export async function saveRefundRelation(request:Parameters<typeof planRefundRelation>[0]){
 await mutate(store=>{new AccountingService(store,store.state.device).execute(snapshot=>planRefundRelation(request,snapshot));if(store.state.importWorkspace)store.state.importWorkspace=refreshRefundAttention(store.state.importWorkspace,{entities:store.entities,conflicts:store.conflicts},request.now);});
}
