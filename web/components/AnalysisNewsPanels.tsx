"use client";

import { fmtWib, fmtWibDate, sanitizeHtml } from "@/lib/format";
import type { Analysis, NewsRow } from "@/lib/types";
import RecommendationBadge from "@/components/RecommendationBadge";
import Pager from "@/components/Pager";
import { usePaged } from "@/lib/usePaged";

// AI Analysis and News side by side, each independently paginated at 10/page.
// Client component because pagination is stateful; the analysis HTML is already
// sanitized before render.
export default function AnalysisNewsPanels({ analyses, news }: { analyses: Analysis[]; news: NewsRow[] }) {
  const ai = usePaged(analyses, 10);
  const nw = usePaged(news, 10);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <section>
        <h2 className="mb-2 font-semibold text-tprimary">AI Analysis</h2>
        {analyses.length === 0 ? (
          <p className="text-sm text-tdim">No analyses yet.</p>
        ) : (
          <>
            <ul className="space-y-3">
              {ai.pageItems.map((a) => (
                <li key={a.id} className="rounded-md border border-edge border-l-2 border-l-ai bg-component p-3">
                  <div className="mb-1 flex items-center gap-2 text-xs text-tdim">
                    <RecommendationBadge rec={a.recommendation} />
                    <span>{fmtWib(a.analysed_at)}</span>
                    {a.model && <span>· {a.model}</span>}
                  </div>
                  <div
                    className="text-sm text-tsecondary"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(a.clean_html || "") }}
                  />
                </li>
              ))}
            </ul>
            <Pager page={ai.page} totalPages={ai.totalPages} onPrev={() => ai.setPage(ai.page - 1)} onNext={() => ai.setPage(ai.page + 1)} />
          </>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-tprimary">News &amp; Sentiment</h2>
        {news.length === 0 ? (
          <p className="text-sm text-tdim">No news.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {nw.pageItems.map((n) => (
                <li key={n.id} className="rounded-md border border-edge bg-component p-3">
                  <a href={n.url} target="_blank" rel="noreferrer" className="text-sm text-tsecondary hover:text-tprimary">
                    {n.headline}
                  </a>
                  <div className="mt-0.5 text-xs text-tdim">
                    {n.source} · {fmtWibDate(n.published_at)}
                    {n.sentiment_score != null && <span> · sentiment <span className="num">{n.sentiment_score}</span></span>}
                  </div>
                  {(n.catalyst || n.risk) && (
                    <div className="mt-1 text-xs text-tmuted">
                      {n.catalyst && <span>Catalyst: {n.catalyst} </span>}
                      {n.risk && <span>· Risk: {n.risk}</span>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <Pager page={nw.page} totalPages={nw.totalPages} onPrev={() => nw.setPage(nw.page - 1)} onNext={() => nw.setPage(nw.page + 1)} />
          </>
        )}
      </section>
    </div>
  );
}
