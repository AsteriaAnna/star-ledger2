-- Read-only effective privileges, including inherited role grants (PostgreSQL 17).
SELECT n.nspname AS schema_name, c.relname AS table_name, r.rolname AS role_name,
       p.privilege_type,
       has_table_privilege(r.oid,c.oid,p.privilege_type) AS actual,
       (r.rolname='service_role' AND
         (p.privilege_type IN ('SELECT','INSERT') OR
          (c.relname='star_ledger_capture_task' AND p.privilege_type='UPDATE'))) AS expected
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN pg_roles r
CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege_type)
WHERE n.nspname='public'
  AND c.relname IN ('star_ledger_capture_task','star_ledger_capture_result')
  AND r.rolname IN ('anon','authenticated','service_role')
ORDER BY c.relname,r.rolname,p.privilege_type;
