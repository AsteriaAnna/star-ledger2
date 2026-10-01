import type {Status} from '../domain/accounting.ts';

export type ImportSourceType='EXCEL'|'SCREENSHOT';
export type SourceSystem='WECHAT'|'ALIPAY'|'SCREENSHOT'|'UNKNOWN';
export type SourcePrecision='second'|'minute'|'day'|'invalid'|string;

export type NormalizedSourceFacts={
 occurredAt:string|null;
 amountFen:number|null;
 transactionTypeRaw:string;
 directionRaw:string;
 statusRaw:string;
 channelRaw:string;
 counterpartyRaw:string;
 productRaw:string;
 noteRaw:string;
 sourceCategoryRaw:string;
 orderId:string|null;
 refundId:string|null;
 originalOrderId:string|null;
 precision:SourcePrecision;
};

export type ExternalRecord={
 id:string;
 sessionId:string;
 sourceIdentity:string;
 sourceType:ImportSourceType;
 sourceSystem:SourceSystem;
 platformRaw:string;
 profile:string;
 rawPayload:string;
 facts:NormalizedSourceFacts;
 parserVersion:number;
 capturedAt:string;
};

export type InterpretedEventKind=
 'PURCHASE'|'INCOME'|'TRANSFER_IN'|'INTERNAL_TRANSFER'|'WITHDRAWAL'|
 'EXTERNAL_TRANSFER'|'DEPOSIT'|'RED_PACKET'|'REPAYMENT'|'REFUND'|'RETURN'|'UNKNOWN';

export type InterpretationEvidenceKind=
 'SOURCE_FACT'|'DETERMINISTIC_RULE'|'RESOLUTION_MEMORY'|'CONTEXTUAL_INFERENCE'|'AI_SUGGESTION';

export type InterpretationEvidence={
 kind:InterpretationEvidenceKind;
 code:string;
 sourceFields:string[];
 detail?:string;
};

export type EventInterpretation={
 externalRecordId:string;
 eventKind:InterpretedEventKind;
 status:Status|'UNKNOWN';
 amountFen:number|null;
 occurredAt:string|null;
 displayName:string;
 channelRaw:string;
 categorySuggestion:string|null;
 evidence:InterpretationEvidence[];
};

export type AttentionKind=
 'ACCOUNT'|'EVENT_MEANING'|'STATUS'|'DATE'|'AMOUNT'|'TEMPLATE'|'REFUND_RELATION'|
 'TRANSFER_ENDPOINTS'|'SPLIT_PAYMENT'|'POSSIBLE_DUPLICATE';

export type AttentionCandidate={
 id:string;
 label:string;
 detail?:string;
};

export type AttentionItem={
 id:string;
 sessionId:string;
 externalRecordId:string;
 kind:AttentionKind;
 question:string;
 blocking:boolean;
 candidates:AttentionCandidate[];
 createdAt:string;
};

export type ImportSessionState='PROCESSING'|'NEEDS_ATTENTION'|'COMPLETED'|'FAILED'|'ROLLED_BACK';

export type ImportSession={
 id:string;
 sourceType:ImportSourceType;
 sourceSystem:SourceSystem;
 createdAt:string;
 updatedAt:string;
 state:ImportSessionState;
 sourceCount:number;
 committedCount:number;
 skippedDuplicateCount:number;
 blockingAttentionCount:number;
 nonBlockingAttentionCount:number;
 failureCode:string|null;
};
