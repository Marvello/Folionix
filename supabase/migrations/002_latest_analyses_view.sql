-- Most recent analysis per ticker (avoids per-row queries from the UI).
create or replace view public.latest_analyses as
select distinct on (ticker) *
from public.llm_analyses
order by ticker, analysed_at desc, id desc;
