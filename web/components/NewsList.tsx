"use client";

import { useState } from "react";
import Link from "next/link";
import { fetchFilteredNews } from "@/app/actions";
import { displayTicker, fmtAgo, newsCutoffIso, parseSummary } from "@/lib/format";
import type { NewsRow } from "@/lib/types";

const BATCH = 15;

export default function NewsList({
  filterTickers,
  initialItems,
}: {
  filterTickers: string[];
  initialItems: NewsRow[];
}) {
  const [selected, setSelected] = useState("All");
  const [count, setCount] = useState(BATCH);
  const [items, setItems] = useState<NewsRow[]>(initialItems);

  async function query(sel: string, n: number) {
    const data = await fetchFilteredNews(sel, n, newsCutoffIso());
    setItems((data ?? []) as NewsRow[]);
  }

  function onFilter(sel: string) {
    setSelected(sel);
    setCount(BATCH);
    query(sel, BATCH);
  }

  function onLoadMore() {
    const next = count + BATCH;
    setCount(next);
    query(selected, next);
  }

  const newest = items[0]?.fetched_at ?? items[0]?.published_at ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-medium text-tprimary">News</h1>
          {newest && (
            <p className="mt-0.5 text-[11px] text-tdim">
              updated {fmtAgo(newest)} · {items.length} items
            </p>
          )}
        </div>
        <select
          value={selected}
          onChange={(e) => onFilter(e.target.value)}
          className="rounded-md border border-edge bg-component px-3 py-1.5 text-sm text-tprimary"
        >
          <option>All</option>
          <option>Macro</option>
          {filterTickers.map((t) => (
            <option key={t} value={t}>{displayTicker(t)}</option>
          ))}
        </select>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-tdim">No news available.</p>
      ) : (
        <ul className="divide-y divide-edge overflow-hidden rounded-lg border border-edge bg-component">
          {items.map((n) => {
            const { imageUrl, text } = n.summary
              ? parseSummary(n.summary)
              : { imageUrl: null, text: "" };
            return (
              <li key={n.id} className="flex gap-4 p-4 transition-colors hover:bg-page/40">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-tdim">
                    <TickerChip ticker={n.ticker} />
                    <span>{n.source}</span>
                    {n.published_at && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{fmtAgo(n.published_at)}</span>
                      </>
                    )}
                  </div>
                  <Link
                    href={`/news?id=${n.id}`}
                    className="block font-medium leading-snug text-tsecondary hover:text-accent"
                  >
                    {n.headline}
                  </Link>
                  {text && <p className="mt-1 line-clamp-2 text-sm text-tmuted">{text}</p>}
                </div>
                {imageUrl && (
                  // RSS images come from arbitrary news-CDN domains; a plain <img>
                  // avoids per-domain next/image remotePatterns config.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageUrl}
                    alt=""
                    className="hidden h-20 w-28 shrink-0 rounded-md border border-edge object-cover sm:block"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {items.length === count && (
        <button
          onClick={onLoadMore}
          className="rounded-md border border-edge px-3 py-1.5 text-sm text-tmuted hover:text-tprimary"
        >
          Load more
        </button>
      )}
    </div>
  );
}

function TickerChip({ ticker }: { ticker: string | null }) {
  if (ticker) {
    return (
      <span className="rounded-full border border-accent/30 px-1.5 py-px font-semibold text-accent">
        {displayTicker(ticker)}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-edge px-1.5 py-px font-semibold text-tmuted">
      MACRO
    </span>
  );
}
