-- 006_security_invoker_views.sql — fix Supabase linter security_definer_view ERRORs
--
-- Postgres views default to SECURITY DEFINER (run as view owner, bypassing RLS
-- of the querying user). Setting security_invoker = true (PG15+) makes the
-- view evaluate RLS as the querying user instead, matching the rest of this
-- schema's RLS model (authenticated reads, service role bypass).

alter view public.latest_snapshots set (security_invoker = true);
alter view public.latest_analyses set (security_invoker = true);
alter view public.latest_gold_prices set (security_invoker = true);
alter view public.latest_fund_navs set (security_invoker = true);
alter view public.news_with_latest_sentiment set (security_invoker = true);

-- fix function_search_path_mutable WARN: pin search_path so the function
-- can't be hijacked by a session-level search_path change.
alter function public.recommendation_accuracy(integer) set search_path = public;

-- fix pg_graphql_anon_table_exposed WARN: RLS already denies anon at the row
-- level, but Supabase's bootstrap grants anon default SELECT on public
-- schema objects, which makes table/column names discoverable via GraphQL
-- introspection even with zero rows returned. Revoke explicitly so anon has
-- no grants at all (matches "anon denied" in this schema's RLS model), and
-- pin default privileges so future tables/views don't inherit the grant.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
