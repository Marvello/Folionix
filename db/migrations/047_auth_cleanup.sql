-- 047: auth hygiene (review P2-DB12).
-- Login lowercases the email and matches lower(email); enforce that two rows can't
-- differ only by case. (Verified 2026-10-06: no case collisions.)
create unique index if not exists uq_users_email_lower on public.users (lower(email));

-- @auth/pg-adapter tables from 036: sessions are JWT and the adapter was never
-- installed, so these have always been empty and nothing reads them.
drop table if exists public.accounts;
drop table if exists public.sessions;
drop table if exists public.verification_token;

insert into public.schema_migrations (version, name)
values ('047', '047_auth_cleanup') on conflict do nothing;
