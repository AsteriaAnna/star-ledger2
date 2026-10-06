-- K05a real acceptance remediation: remove privileges inherited from table-creation default ACL.
-- Apply once after 003; rerunnable. Only these two tables, never global/default privileges.
DO LANGUAGE plpgsql $migration$
BEGIN
 EXECUTE 'REVOKE ALL ON public.star_ledger_capture_task, public.star_ledger_capture_result FROM PUBLIC, anon, authenticated, service_role';
 EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.star_ledger_capture_task TO service_role';
 EXECUTE 'GRANT SELECT, INSERT ON public.star_ledger_capture_result TO service_role';
END
$migration$;
