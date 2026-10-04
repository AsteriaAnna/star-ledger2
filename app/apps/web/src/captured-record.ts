import type {FinancialEvent} from '../../../packages/domain/accounting.ts';
import {BusinessAccountingService} from '../../../packages/accounting/business.ts';
import {AccountingService} from '../../../packages/accounting/index.ts';
import {needsSplitFunding} from '../../../packages/importing/channel.ts';
import {mutate} from './store.ts';
import {existingSource,ruleCommand,safeCandidates} from './import-workflow.ts';

/** Save the answered capture and its recovery state together; no second approval queue. */
export async function saveCapturedRecord(input:{index:number;expectedRevision:number;event:FinancialEvent;independent?:boolean}){
 await mutate(store=>{
  if((store.state.importRevision||0)!==input.expectedRevision)throw Error('STALE_CAPTURE');
  const draft=store.state.imports?.[input.index];
  if(!draft||['committed','linked','ignored','noeffect'].includes(draft.workflow||''))throw Error('STALE_CAPTURE');
  if(needsSplitFunding(draft.channel))throw Error('COMPOUND_CAPTURE');
  if(existingSource(draft,store.entities).length)throw Error('CAPTURE_ALREADY_RECORDED');
  if(safeCandidates(draft,store.entities).length&&!input.independent)throw Error('CAPTURE_POSSIBLE_DUPLICATE');
  new BusinessAccountingService(store,store.state.device).execute(input.event);
  new AccountingService(store,store.state.device).execute([ruleCommand(store.entities,'source-'+(draft.identity||draft.key),{transactionId:input.event.id})]);
  draft.workflow='committed';draft.transactionId=input.event.id;draft.selected=false;
  store.state.importRevision=input.expectedRevision+1;
 });
}
