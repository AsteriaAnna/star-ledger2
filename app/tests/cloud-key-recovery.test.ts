import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryKey,wrapRecoveryKey,unwrapRecoveryKey} from '../packages/platform/password-key.ts';
import {webSessionCrypto} from '../packages/platform/web-crypto.ts';
test('same login password restores the opaque ledger key; wrong password and other owner cannot open it',async()=>{
 const key=createRecoveryKey(),wrapped=await wrapRecoveryKey(key,'test-only-password','A','cloud-a');assert.equal(wrapped.includes(key),false);assert.equal(await unwrapRecoveryKey(wrapped,'test-only-password','A','cloud-a'),key);await assert.rejects(unwrapRecoveryKey(wrapped,'wrong-password','A','cloud-a'),/CLOUD_KEY_UNLOCK_FAILED/);await assert.rejects(unwrapRecoveryKey(wrapped,'test-only-password','B','cloud-a'),/CLOUD_OWNER_MISMATCH/);
 const first=await webSessionCrypto('cloud-a',key),other=await webSessionCrypto('cloud-a',await unwrapRecoveryKey(wrapped,'test-only-password','A','cloud-a'));
 const b={version:1 as const,device:'test',seq:1,operations:[],checksum:'test'};assert.deepEqual(await other.open(await first.seal(b)),b);
});
