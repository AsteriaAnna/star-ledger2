const CloudBase = require('@cloudbase/manager-node');
const { createHash } = require('node:crypto');
const { createRepository, claimSql } = require('./registration-repository.cjs');
const digest = text => createHash('sha256').update(text).digest('hex');
const fixture = kind => ({
  id: digest('star-ledger:pg-probe:20261005:' + kind),
  username: 'slpgprobe_' + kind,
  uid: 'sl' + digest('star-ledger:pg-probe:uid:' + kind).slice(0, 62)
});
function safeCode(error) {
  const code = error?.code ?? error?.errCode ?? (/^REGISTRATION_CLAIM_/.test(error?.message || '') ? error.message : undefined);
  return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_.]{1,95}$/.test(code)
    ? code : 'PG_PROBE_FAILED';
}
// Console only. Fixed diagnostics cannot accept SQL, credentials or user data.
// Write modes create only reserved probe claims; never identity-provider users.
exports.main = async event => {
  if (!event || event.httpMethod || event.headers ||
      !['connection-readonly', 'claim-concurrency', 'transaction-rollback'].includes(event.mode)) {
    return { ok: false, code: 'CONSOLE_PROBE_ONLY' };
  }
  const started = Date.now();
  try {
    const manager = CloudBase.init({
      envId: 'xingzhang-dev-d0g4a950c6f1204d1', region: 'ap-shanghai',
      secretId: process.env.TENCENTCLOUD_SECRETID,
      secretKey: process.env.TENCENTCLOUD_SECRETKEY,
      token: process.env.TENCENTCLOUD_SESSIONTOKEN, timeout: 1800
    });
    const database = manager.database;
    if (event.mode === 'connection-readonly') {
      const result = await database.executePGSql({
        Sql: 'SELECT 1 AS connected, count(*) AS claims FROM public.star_ledger_registration',
        Role: 'service_role'
      });
      if (!Array.isArray(result.Rows) || result.Rows.length !== 1 ||
          JSON.parse(result.Rows[0])[0] !== '1') throw Error('PG_PROBE_RESULT_INVALID');
    } else if (event.mode === 'claim-concurrency') {
      const shapes = [];
      const inspectedDatabase = { async executePGSql(options) {
        const result = await database.executePGSql(options);
        shapes.push({
          columns: result.Columns, rowsType: typeof result.Rows,
          rowCount: result.Rows?.length ?? null,
          firstRowType: result.Rows?.length ? typeof result.Rows[0] : null,
          affectedRows: result.AffectedRows ?? null
        });
        return result;
      }};
      const repository = createRepository(inspectedDatabase), row = fixture('concurrency');
      const outcomes = await Promise.allSettled([repository.claim(row), repository.claim(row)]);
      const results = outcomes.filter(x => x.status === 'fulfilled').map(x => x.value);
      if (outcomes.some(x => x.status === 'rejected')) {
        return { ok: false, mode: event.mode, shapes,
          codes: outcomes.filter(x => x.status === 'rejected').map(x => safeCode(x.reason)),
          elapsedMs: Date.now() - started };
      }
      return { ok: results.filter(Boolean).length === 1, mode: event.mode,
        winners: results.filter(Boolean).length, elapsedMs: Date.now() - started };
    } else {
      const row = fixture('rollback');
      // Deliberate exception rolls back the nested transaction. Verify absence
      // in the same call; no cleanup DELETE is needed for this mode.
      const Sql = `DO LANGUAGE plpgsql $probe$
BEGIN
  IF EXISTS (SELECT 1 FROM public.star_ledger_registration WHERE id = '${row.id}') THEN
    RAISE EXCEPTION 'PROBE_FIXTURE_ALREADY_EXISTS';
  END IF;
  BEGIN
    ${claimSql(row)};
    RAISE EXCEPTION 'PROBE_ROLLBACK' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.star_ledger_registration WHERE id = '${row.id}') THEN
    RAISE EXCEPTION 'PROBE_ROLLBACK_FAILED';
  END IF;
END
$probe$`;
      // INSERT ... RETURNING cannot run without INTO inside PL/pgSQL.
      await database.executePGSql({
        Sql: Sql.replace(' RETURNING 1 AS claimed', ''), Role: 'service_role'
      });
    }
    return { ok: true, mode: event.mode, elapsedMs: Date.now() - started };
  } catch (error) {
    return { ok: false, mode: event.mode, code: safeCode(error), elapsedMs: Date.now() - started };
  }
};
