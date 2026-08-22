-- NextAuth (Auth.js) tables for @auth/pg-adapter.
-- Replaces Supabase Auth (auth.users lived in Supabase's managed auth schema).
-- Column names use camelCase with double-quote escaping — required by the adapter.

create table if not exists public.users (
  id serial primary key,
  name varchar(255),
  email varchar(255) unique,
  "emailVerified" timestamptz,
  image text,
  password_hash text not null
);

create table if not exists public.accounts (
  id serial primary key,
  "userId" integer not null references public.users(id) on delete cascade,
  type varchar(255) not null,
  provider varchar(255) not null,
  "providerAccountId" varchar(255) not null,
  refresh_token text,
  access_token text,
  expires_at bigint,
  id_token text,
  scope text,
  session_state text,
  token_type text
);

create table if not exists public.sessions (
  id serial primary key,
  "userId" integer not null references public.users(id) on delete cascade,
  expires timestamptz not null,
  "sessionToken" varchar(255) not null unique
);

create table if not exists public.verification_token (
  identifier text not null,
  expires timestamptz not null,
  token text not null,
  primary key (identifier, token)
);

insert into public.schema_migrations (version, name)
values ('036', '036_nextauth_tables')
on conflict do nothing;
