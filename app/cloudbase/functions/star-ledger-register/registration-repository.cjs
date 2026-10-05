const usernamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{4,23}$/;

// The manager API has no bind-parameter option. Validate every interpolated value
// against a closed alphabet (none can contain quotes or SQL operators).
function claimSql(row) {
  if (!row || !/^[a-f0-9]{64}$/.test(row.id) ||
      !usernamePattern.test(row.username) || !/^sl[a-f0-9]{62}$/.test(row.uid)) {
    throw new Error('REGISTRATION_CLAIM_INVALID');
  }
  return `INSERT INTO public.star_ledger_registration (id, username, uid)
VALUES ('${row.id}', '${row.username}', '${row.uid}')
ON CONFLICT DO NOTHING`;
}

function claimedFrom(result) {
  // ExecutePGSql reports INSERT results through AffectedRows (Rows/Columns
  // are null even with RETURNING). Accept only the exact documented 0/1 count.
  if (result?.AffectedRows === 1) return true;
  if (result?.AffectedRows === 0) return false;
  throw new Error('REGISTRATION_CLAIM_RESULT_INVALID');
}

function createRepository(database) {
  return {
    async claim(row) {
      // One statement is one PG transaction. The unique index arbitrates
      // concurrent requests; an existing invitation/username/uid is never updated.
      const result = await database.executePGSql({
        Sql: claimSql(row), Role: 'service_role'
      });
      return claimedFrom(result);
    }
  };
}
module.exports = { createRepository, claimSql, claimedFrom };
