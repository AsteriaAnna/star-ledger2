import test from 'node:test';
import assert from 'node:assert/strict';
import {runLifecycleAudit} from '../scripts/audit-m5-lifecycle.ts';
import {mergeImportOutcomes} from '../packages/application/import-execution.ts';

test('import lifecycle preserves user corrections, unresolved decisions and usable successors',async()=>{
 const {findings}=await runLifecycleAudit();
 assert.equal(findings.length,3);
 for(const finding of findings)assert.equal(finding.violation,false,JSON.stringify(finding));
 const retry=findings.find(f=>f.id==='UNANSWERED_SOURCE_UPDATE_LOST_ON_RETRY')!;
 assert.equal(retry.retryDisposition,'SOURCE_UPDATE');assert.equal(retry.afterAttention,1);
 const batch=findings.find(f=>f.id==='FAILED_PREDECESSOR_BREAKS_BATCH')!;
 assert.equal(batch.error,null);assert.equal(batch.transactionCount,2);
});

test('replaying evidence preserves committed and blocked outcomes, while a real answer can finish a blocked row',()=>{
 const base={sessionId:'s',updatedAt:'2026-10-03T00:00:00Z'};
 const prior=[{...base,externalRecordId:'posted',state:'COMMITTED' as const,transactionId:'tx'},{...base,externalRecordId:'question',state:'BLOCKED' as const,transactionId:null}];
 const replay=prior.map(o=>({...o,state:'SKIPPED_DUPLICATE' as const,transactionId:null}));
 assert.deepEqual(mergeImportOutcomes(prior,replay),prior);
 assert.equal(mergeImportOutcomes(prior,[{...prior[1],state:'COMMITTED',transactionId:'answer'}])[1].state,'COMMITTED');
});
