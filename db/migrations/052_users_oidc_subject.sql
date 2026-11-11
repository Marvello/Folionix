-- Bind Authentik SSO logins to the IdP's stable (iss, sub) instead of the email
-- claim (web/lib/oidcUser.ts). Format: '<iss>#<sub>'. Null = never used SSO;
-- the first verified-email SSO login fills it.
alter table public.users add column if not exists oidc_subject text;
create unique index if not exists uq_users_oidc_subject on public.users (oidc_subject);

insert into public.schema_migrations (version, name) values ('052', '052_users_oidc_subject') on conflict do nothing;
