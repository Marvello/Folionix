# Pipelines

Orchestration and processing flows.

- [portfolio analysis](portfolio-analysis.md) — per-position fetch → LLM → alert (CLI)
- [watchlist analysis](watchlist-analysis.md) — watchlist BUY NOW / WAIT / AVOID (CLI)
- [price refresh](price-refresh.md) — price-only snapshot refresh, idempotent
- [news sentiment](news-sentiment.md) — RSS fetch → cache → LLM sentiment
- [orchestrator (outer graph)](orchestrator.md) — session + signal routing (long-running)
- [analysis graph (inner graph)](analysis-graph.md) — per-ticker fan-out analysis
- [gold holdings](gold-holdings.md) — per-venue gold price refresh + holdings valuation
- [fund NAVs](fund-navs.md) — per-source mutual-fund NAV refresh + holdings valuation
- [bond holdings](bond-holdings.md) — bond holdings valuation at par (no provider)
- [dividend schedule](dividend-schedule.md) — daily dividend sync + ex-date/pay-date reminders
- [forex rates](forex-rates.md) — daily FX-to-IDR refresh for foreign-currency fund valuation
- [week review](week-review.md) — Saturday retrospective: WoW numbers + AI self-review + handover doc (email/Telegram/web)
