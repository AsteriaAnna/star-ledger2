-- R14 / C05 / C06 / M6: narrow platform default grants and username aliases.
REVOKE ALL ON public.star_ledger_registration FROM service_role;
GRANT SELECT, INSERT ON public.star_ledger_registration TO service_role;
CREATE UNIQUE INDEX star_ledger_registration_username_folded_key
  ON public.star_ledger_registration (lower(username));
