import {BusinessAccountingService} from '../../../packages/accounting/business.ts';
import {planLateRefundRelations,refreshRefundAttention} from '../../../packages/application/late-refund-relations.ts';
import type {MemoryStore} from './store.ts';
/** Called inside the same Web mutation that writes ledger and workspace. */
export function finalizeImportRefunds(store:MemoryStore,now:string){
 const commands=planLateRefundRelations({entities:store.entities,conflicts:store.conflicts});
 if(commands.length)new BusinessAccountingService(store,store.state.device).executeBatch(commands);
 if(store.state.importWorkspace)store.state.importWorkspace=refreshRefundAttention(store.state.importWorkspace,{entities:store.entities,conflicts:store.conflicts},now);
}
