---
type: dataset
title: Finnhub quotes
description: Best-effort fallback feed (REST) for price and fundamentals when yahoo-finance2 fails or returns empty data.
resource: app/src/providers/finnhub.ts
tags: [finnhub, market-data, external, fallback]
generated:
  by: human:marvellooni
  at: 2026-06-18T00:00:00Z
status: stable
---

# Finnhub quotes

`finnhub.fetch_quote` is a pure REST fallback used by
[yahoo-finance2 market data](yahoo-finance2-market-data.md) when the primary feed misses.
Disabled when `FINNHUB_API_KEY` is unset; never raises (all failures return
`None`). Free tier covers `/quote` (price); fundamentals via `/stock/metric`
are best-effort and often absent for non-US (IDX) tickers.

Caveat: Finnhub prices and market cap are USD, not IDR — unlike yahoo-finance2 for
`.JK` tickers. Market cap is reported in millions and converted to absolute.

## Related

- Invoked from `market.fetch_stock`; output merges into
  [stock_snapshots](../tables/stock-snapshots.md).
