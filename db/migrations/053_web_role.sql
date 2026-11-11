-- Least-privilege role for the web dashboard (security audit run-2).
-- folionix_web gets DML on the app's tables but no DDL, TRUNCATE, ownership,
-- or superuser powers (no COPY PROGRAM / file reads). Created NOLOGIN: the
-- operator enables it with a password out of band (knowledge/runbooks/web-db-role.md),
-- so no secret ever lives in git. The app services keep the owner role (they
-- run migrations).
--
-- Skips with a NOTICE when the migrating role can't create roles, so a
-- restricted deployment never crash-loops on this file.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = current_user and (rolsuper or rolcreaterole)) then
    raise notice '053: % cannot create roles; skipping folionix_web', current_user;
    return;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'folionix_web') then
    create role folionix_web nologin;
  end if;
  execute format('grant connect on database %I to folionix_web', current_database());
  grant usage on schema public to folionix_web;
  grant select, insert, update, delete on all tables in schema public to folionix_web;
  grant usage, select on all sequences in schema public to folionix_web;
  grant execute on all functions in schema public to folionix_web;
  -- Tables/sequences/functions created later by this (owner) role get the same grants.
  alter default privileges in schema public grant select, insert, update, delete on tables to folionix_web;
  alter default privileges in schema public grant usage, select on sequences to folionix_web;
  alter default privileges in schema public grant execute on functions to folionix_web;
  -- The migration ledger is the app's business, read-only for web.
  revoke insert, update, delete on public.schema_migrations from folionix_web;
end
$$;

insert into public.schema_migrations (version, name) values ('053', '053_web_role') on conflict do nothing;
