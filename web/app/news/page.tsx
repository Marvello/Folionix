import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getPool } from "@/lib/db";
import { displayTicker, fmtWib, fmtAgo, dirGlyph, parseSummary, newsCutoffIso } from "@/lib/format";
import type { NewsRow, Position, WatchRow } from "@/lib/types";
import NewsList from "@/components/NewsList";

export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const pool = getPool();

  if (id) {
    const { rows } = await pool.query(
      "SELECT * FROM news_with_latest_sentiment WHERE id = $1 LIMIT 1",
      [Number(id)],
    );
    const n = (rows[0] ?? null) as NewsRow | null;
    if (!n) {
      return (
        <div>
          <Link href="/news" className="inline-flex items-center gap-1 text-sm text-accent hover:underline"><ArrowLeft size={14} strokeWidth={1.5} /> Back to News</Link>
          <p className="mt-4 text-tmuted">News article not found.</p>
        </div>
      );
    }
    const label = n.ticker ? displayTicker(n.ticker) : "MACRO";
    const summary = n.summary ? parseSummary(n.summary) : null;
    const hasInsight =
      !!n.ticker && (n.sentiment_score != null || !!n.themes || !!n.catalyst || !!n.risk);
    return (
      <article className="mx-auto max-w-3xl space-y-5">
        <Link href="/news" className="inline-flex items-center gap-1 text-sm text-accent hover:underline"><ArrowLeft size={14} strokeWidth={1.5} /> Back to News</Link>

        <header className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-tdim">
            <span
              className={`rounded-full border px-1.5 py-px font-semibold ${
                n.ticker ? "border-accent/30 text-accent" : "border-edge text-tmuted"
              }`}
            >
              {label}
            </span>
            <span>{n.source}</span>
            <span aria-hidden>·</span>
            <span>{fmtWib(n.published_at)}</span>
            {n.fetched_at && <span className="text-tdim">· synced {fmtAgo(n.fetched_at)}</span>}
          </div>
          <h1 className="text-3xl font-medium leading-tight text-tprimary">{n.headline}</h1>
        </header>

        {summary?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={summary.imageUrl}
            alt=""
            className="max-h-[28rem] w-full rounded-lg border border-edge object-cover"
          />
        )}

        {summary?.text && (
          <p className="text-[15px] leading-relaxed text-tsecondary">{summary.text}</p>
        )}

        {hasInsight && (
          <section className="rounded-lg border border-edge border-l-2 border-l-ai bg-component p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className="rounded-full bg-ai-surface px-2.5 py-0.5 text-xs font-semibold uppercase tracking-[0.04em] text-ai-bright">
                Model read
              </span>
              {n.sentiment_score != null && (
                <span className="num text-sm font-semibold text-ai-bright">
                  {dirGlyph(n.sentiment_score)} sentiment {n.sentiment_score >= 0 ? "+" : ""}
                  {n.sentiment_score}
                </span>
              )}
            </div>
            <dl className="space-y-2 text-sm">
              {n.themes && <InsightRow term="Themes" desc={n.themes} />}
              {n.catalyst && <InsightRow term="Catalyst" desc={n.catalyst} />}
              {n.risk && <InsightRow term="Risk" desc={n.risk} />}
            </dl>
            <p className="mt-3 text-[11px] text-tdim">
              Latest model sentiment for {label} · not measured fact
            </p>
          </section>
        )}

        {n.url && (
          <a
            href={n.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline"
          >
            Open original article <ExternalLink size={14} strokeWidth={1.5} />
          </a>
        )}
      </article>
    );
  }

  const [posRes, watchRes, newsRes] = await Promise.all([
    pool.query("SELECT ticker FROM portfolio_positions WHERE active = true"),
    pool.query("SELECT ticker FROM watchlist"),
    pool.query(
      "SELECT * FROM news_cache WHERE published_at >= $1 ORDER BY published_at DESC LIMIT 15",
      [newsCutoffIso()],
    ),
  ]);
  const tickers = Array.from(
    new Set([
      ...(posRes.rows as Position[]).map((p) => p.ticker.toUpperCase()),
      ...(watchRes.rows as WatchRow[]).map((w) => w.ticker.toUpperCase()),
    ]),
  ).sort();

  return <NewsList filterTickers={tickers} initialItems={newsRes.rows as NewsRow[]} />;
}

function InsightRow({ term, desc }: { term: string; desc: string }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-3">
      <dt className="text-tdim">{term}</dt>
      <dd className="text-tsecondary">{desc}</dd>
    </div>
  );
}
