-- 027_revoke_rpc_execute
--
-- SECURITY DEFINER functions bypass RLS. Postgres grants EXECUTE to PUBLIC by
-- default, and Supabase's anon/authenticated roles inherit PUBLIC — so despite
-- migration 006 revoking table grants from anon, the anon key could still call
-- these RPCs over PostgREST (/rest/v1/rpc/...). claim_analysis_job returns
-- analysis_jobs rows and mutates the queue (info disclosure + DoS);
-- recompute_stock_position writes portfolio_positions. Lock EXECUTE down.
--
-- claim_analysis_job: only the worker (service_role) ever calls it.
revoke execute on function public.claim_analysis_job(integer) from public, anon, authenticated;
grant execute on function public.claim_analysis_job(integer) to service_role;

-- recompute_stock_position: only ever called internally by the
-- stock_transactions trigger (which runs as the definer owner, so it does not
-- need an EXECUTE grant here). No external caller should reach it.
revoke execute on function public.recompute_stock_position(varchar) from public, anon, authenticated;
grant execute on function public.recompute_stock_position(varchar) to service_role;

-- recommendation_accuracy is SECURITY INVOKER (reads under caller RLS, so anon
-- gets nothing), but tighten EXECUTE to authenticated + backend for consistency.
revoke execute on function public.recommendation_accuracy(integer) from public, anon;
grant execute on function public.recommendation_accuracy(integer) to authenticated, service_role;

insert into public.schema_migrations (version, name)
values ('027', '027_revoke_rpc_execute') on conflict do nothing;
