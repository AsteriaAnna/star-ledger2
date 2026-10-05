const CloudBase = require('@cloudbase/manager-node');
const { invitesFrom, register } = require('./policy.cjs');
const { createHandler } = require('./http.cjs');
const { createRepository } = require('./registration-repository.cjs');
const env = 'xingzhang-dev-d0g4a950c6f1204d1';
const origin = 'https://xingzhang-dev-d0g4a950c6f1204d1-1428502724.tcloudbaseapp.com';

// Read injected short-lived credentials during invocation, not at cold-start.
// No API key or long-lived secret is used or returned.
function createManager() {
  return CloudBase.init({
    envId: env, region: 'ap-shanghai', timeout: 1800,
    secretId: process.env.TENCENTCLOUD_SECRETID,
    secretKey: process.env.TENCENTCLOUD_SECRETKEY,
    token: process.env.TENCENTCLOUD_SESSIONTOKEN
  });
}
exports.main = createHandler({
  origin,
  register: async input => {
    const invites = invitesFrom(process.env.STAR_LEDGER_INVITES_JSON);
    if (!invites.length) return { ok: false, code: 'REGISTRATION_CLOSED' };
    try {
      const manager = createManager();
      return await register(input, {
        invites, repository: createRepository(manager.database),
        createUser: user => manager.user.createUser(user)
      });
    } catch {
      return { ok: false, code: 'REGISTRATION_UNAVAILABLE' };
    }
  }
});
