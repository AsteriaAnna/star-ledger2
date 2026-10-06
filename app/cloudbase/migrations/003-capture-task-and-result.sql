-- R03/C02/C06: single ExecutePGSql request; isolated from registration and ledger sync.
DO LANGUAGE plpgsql $migration$
BEGIN
 EXECUTE $ddl$
 CREATE TABLE IF NOT EXISTS public.star_ledger_capture_task (
  user_id text NOT NULL, ledger_id text NOT NULL, task_id text NOT NULL,
  version bigint NOT NULL CHECK (version >= 0), payload jsonb NOT NULL,
  PRIMARY KEY (user_id,ledger_id,task_id),
  CHECK ((jsonb_typeof(payload)='object' AND payload->>'userId'=user_id AND payload->>'ledgerId'=ledger_id AND payload->>'id'=task_id) IS TRUE),
  CHECK (((payload->>'version')::bigint=version) IS TRUE),
  CHECK ((payload->>'state' IN ('LOCAL_QUEUED','UPLOADING','ACCEPTED','ANALYZING','RECONCILING','READY','NEEDS_INPUT','RETRYABLE_FAILURE','CANCELLED','EXPIRED')) IS TRUE)
 )$ddl$;
 EXECUTE $ddl$
 CREATE TABLE IF NOT EXISTS public.star_ledger_capture_result (
  user_id text NOT NULL, ledger_id text NOT NULL, task_id text NOT NULL,
  result_id text NOT NULL, response_hash text NOT NULL, evidence jsonb NOT NULL,
  PRIMARY KEY (user_id,ledger_id,task_id,result_id),
  FOREIGN KEY (user_id,ledger_id,task_id) REFERENCES public.star_ledger_capture_task,
  CHECK ((jsonb_typeof(evidence)='object' AND evidence->>'id'=result_id AND evidence->>'responseHash'=response_hash) IS TRUE)
 )$ddl$;
 EXECUTE 'ALTER TABLE public.star_ledger_capture_task ENABLE ROW LEVEL SECURITY';
 EXECUTE 'ALTER TABLE public.star_ledger_capture_task FORCE ROW LEVEL SECURITY';
 EXECUTE 'ALTER TABLE public.star_ledger_capture_result ENABLE ROW LEVEL SECURITY';
 EXECUTE 'ALTER TABLE public.star_ledger_capture_result FORCE ROW LEVEL SECURITY';
 EXECUTE 'REVOKE ALL ON public.star_ledger_capture_task, public.star_ledger_capture_result FROM PUBLIC, anon, authenticated';
 EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.star_ledger_capture_task TO service_role';
 EXECUTE 'GRANT SELECT, INSERT ON public.star_ledger_capture_result TO service_role';
END
$migration$;
