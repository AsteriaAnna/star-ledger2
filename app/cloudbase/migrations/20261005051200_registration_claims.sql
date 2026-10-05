-- R14 / C05 / C06 / M6: durable invitation claims, server access only.
CREATE TABLE public.star_ledger_registration (
  id text PRIMARY KEY CHECK (id ~ '^[a-f0-9]{64}$'),
  username text NOT NULL UNIQUE CHECK (username ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{4,23}$'),
  uid text NOT NULL UNIQUE CHECK (uid ~ '^sl[a-f0-9]{62}$'),
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.star_ledger_registration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.star_ledger_registration FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.star_ledger_registration FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.star_ledger_registration TO service_role;
