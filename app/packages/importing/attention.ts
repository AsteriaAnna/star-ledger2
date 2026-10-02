import type {AttentionItem,ImportSession,ImportSessionState} from './types.ts';

export function attentionId(sessionId:string,externalRecordId:string,kind:AttentionItem['kind']){
 return `attention:${sessionId}:${externalRecordId}:${kind}`;
}

export function summarizeSession(session:ImportSession,items:AttentionItem[],updatedAt:string):ImportSession{
 const blocking=items.filter(item=>item.blocking).length,nonBlocking=items.length-blocking;
 const state:ImportSessionState=session.state==='FAILED'||session.state==='ROLLED_BACK'?session.state:blocking?'NEEDS_ATTENTION':session.sourceCount>0&&session.committedCount+session.skippedDuplicateCount+session.noEffectCount>=session.sourceCount?'COMPLETED':'PROCESSING';
 return {...session,updatedAt,state,blockingAttentionCount:blocking,nonBlockingAttentionCount:nonBlocking};
}

export function assertAttentionItem(item:AttentionItem){
 if(!item.id||!item.sessionId||!item.externalRecordId||!item.question.trim())throw Error('INVALID_ATTENTION_ITEM');
 if(item.candidates.some(candidate=>!candidate.id||!candidate.label.trim()))throw Error('INVALID_ATTENTION_CANDIDATE');
}
