# Datasets

Derived database views, external feeds, and in-memory datasets.

## Views

- [latest_snapshots](latest-snapshots.md) — newest snapshot per ticker
- [latest_analyses](latest-analyses.md) — newest analysis per ticker
- [news_with_latest_sentiment](news-with-latest-sentiment.md) — news joined to latest sentiment
- [latest_gold_prices](latest-gold-prices.md) — newest price snapshot per gold venue
- [latest_fund_navs](latest-fund-navs.md) — newest NAV snapshot per fund
- [fund_product_summary](fund-product-summary.md) — per-fund net units, avg NAV, unrealized + realized P&L
- [latest_forex_rates](latest-forex-rates.md) — newest FX-to-IDR rate per currency pair

## External feeds

- [yahoo-finance2 market data](yahoo-finance2-market-data.md) — primary market feed
- [Finnhub quotes](finnhub-quotes.md) — fallback price/fundamentals feed
- [news RSS feeds](news-rss-feeds.md) — Google News + Indonesian financial RSS

## Derived

- [active portfolio](active-portfolio.md) — in-memory map from portfolio_positions
