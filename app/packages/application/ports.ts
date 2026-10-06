import type {AttentionItem,CaptureEvidence,EventInterpretation,ExternalRecord,ImportRecordOutcome,ImportSession} from '../importing/types.ts';

export type AccountIdentity={
 sourceSystem:string;
 profile:string;
 channelKey:string;
 role:string;
};

export type AccountMapping={
 accountId:string;
 rememberedAt:string;
};

export type MerchantIdentity={
 sourceSystem:string;
 profile:string;
 merchantKey:string;
};

export type CategoryMapping={
 categoryId:string;
 rememberedAt:string;
};

export interface ResolutionMemoryRepository {
 findAccountMapping(key:AccountIdentity):Promise<AccountMapping|null>;
 rememberAccountMapping(key:AccountIdentity,mapping:AccountMapping):Promise<void>;
 findMerchantCategory(key:MerchantIdentity):Promise<CategoryMapping|null>;
 rememberMerchantCategory(key:MerchantIdentity,mapping:CategoryMapping):Promise<void>;
}

export interface ImportWorkspaceRepository {
 getSession(id:string):Promise<ImportSession|null>;
 listSessions():Promise<ImportSession[]>;
 putSession(session:ImportSession):Promise<void>;
 listExternalRecords(sessionId:string):Promise<ExternalRecord[]>;
 listCaptureEvidence(sessionId:string):Promise<CaptureEvidence[]>;
 putExternalRecords(records:ExternalRecord[]):Promise<void>;
 listAttentionItems(sessionId:string):Promise<AttentionItem[]>;
 listOutcomes(sessionId:string):Promise<ImportRecordOutcome[]>;
 replaceOutcomes(sessionId:string,outcomes:ImportRecordOutcome[]):Promise<void>;
 replaceAttentionItems(sessionId:string,items:AttentionItem[]):Promise<void>;
 saveSessionSnapshot(session:ImportSession,records:ExternalRecord[],items:AttentionItem[],interpretations?:EventInterpretation[],captureEvidence?:CaptureEvidence[]):Promise<void>;
 clearSession(id:string):Promise<void>;
}
