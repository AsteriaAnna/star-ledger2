import type {AttentionItem,ExternalRecord} from '../../../packages/importing/types.ts';
import {channelKey,describeFundingChannel} from '../../../packages/importing/channel.ts';

/** Match the existing account answer's scope; one answer already resolves the group. */
export function importQuestionGroups(items:AttentionItem[],records:ExternalRecord[]){
 const groups=new Map<string,{item:AttentionItem;count:number;source?:ExternalRecord}>();
 for(const item of items){
  const source=records.find(r=>r.id===item.externalRecordId);
  const key=item.kind==='ACCOUNT'&&!item.blocking&&source?JSON.stringify([source.sourceSystem,source.profile,describeFundingChannel(source.platformRaw,source.facts.channelRaw)?.identity||channelKey(source.facts.channelRaw)]):item.id;
  const group=groups.get(key);if(group)group.count++;else groups.set(key,{item,count:1,source});
 }
 return [...groups.values()];
}
