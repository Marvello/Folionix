-- Runtime-editable settings (web /settings page). One row per overridden key;
-- a row here beats the matching .env variable, deleting it falls back to .env.
-- The key whitelist + validation live in lib/settings.ts — never store secrets here.

create table if not exists public.app_settings (
    key         text primary key,
    value       text not null,
    updated_at  timestamptz not null default now(),
    updated_by  text
);

insert into public.schema_migrations (version, name) values ('051', '051_app_settings') on conflict do nothing;
