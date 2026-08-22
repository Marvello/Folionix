import Link from "next/link";
import { ArrowLeft, ChevronRight, Mail } from "lucide-react";
import { getPool } from "@/lib/db";
import { fmtIdr, fmtWibDate } from "@/lib/format";
import type { WeeklyReview } from "@/lib/types";
import MarkdownView from "@/components/MarkdownView";
import CopyButton from "@/components/CopyButton";
import EmptyState from "@/components/EmptyState";

const pctStr = (n: number | null | undefined): string =>
  n == null ? "N/A" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { id } = await searchParams;
  const pool = getPool();

  if (id) {
    const { rows } = await pool.query(
      "SELECT * FROM weekly_reviews WHERE id = $1 LIMIT 1",
      [Number(id)],
    );
    const r = (rows[0] ?? null) as WeeklyReview | null;
    if (!r) {
      return (
        <div>
          <Link href="/reviews" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
            <ArrowLeft size={14} strokeWidth={1.5} /> Back to Reviews
          </Link>
          <p className="mt-4 text-tmuted">Review not found.</p>
        </div>
      );
    }
    return (
      <article className="mx-auto max-w-3xl space-y-6">
        <Link href="/reviews" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
          <ArrowLeft size={14} strokeWidth={1.5} /> Back to Reviews
        </Link>

        <MarkdownView markdown={r.report_md} />

        {r.handover_md && (
          <section className="space-y-3 rounded-md border border-edge bg-component p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-tprimary">Handover document</h2>
                <p className="text-xs text-tdim">
                  Raw data + system description — paste into a stronger LLM to get improvement suggestions.
                </p>
              </div>
              <CopyButton text={r.handover_md} label="Copy handover markdown" />
            </div>
            <details>
              <summary className="cursor-pointer text-xs font-medium text-tmuted hover:text-tprimary">
                Preview
              </summary>
              <div className="mt-3">
                <MarkdownView markdown={r.handover_md} />
              </div>
            </details>
          </section>
        )}
      </article>
    );
  }

  const { rows } = await pool.query(
    "SELECT id, week_start, week_end, stats, model, emailed, created_at FROM weekly_reviews ORDER BY week_end DESC LIMIT 52",
  );
  const reviews = rows as WeeklyReview[];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-tprimary">Weekly Reviews</h1>
      {reviews.length === 0 ? (
        <EmptyState message="No weekly reviews yet — generated every Saturday morning, or on demand via the /weekreview Telegram command." />
      ) : (
        <>
        <div className="space-y-3 md:hidden">
          {reviews.map((r) => {
            const wow = r.stats?.wow_pct;
            return (
              <Link key={r.id} href={`/reviews?id=${r.id}`} className="block rounded-lg border border-edge bg-component p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-tprimary">{r.week_start} {"→"} {r.week_end}</span>
                  <ChevronRight size={15} strokeWidth={1.5} className="text-tdim" />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-tdim">Net Worth</span>
                  <span className="num text-right text-tprimary">{r.stats?.net_worth != null ? fmtIdr(r.stats.net_worth) : "N/A"}</span>
                  <span className="text-tdim">WoW</span>
                  <span className={`num text-right ${wow == null ? "text-tdim" : wow >= 0 ? "text-up" : "text-down"}`}>{pctStr(wow)}</span>
                  <span className="text-tdim">Accuracy</span>
                  <span className="num text-right text-tprimary">
                    {r.stats?.accuracy_pct != null ? `${r.stats.accuracy_pct.toFixed(0)}% (n=${r.stats.accuracy_n ?? 0})` : "—"}
                  </span>
                  <span className="text-tdim">Generated</span>
                  <span className="text-right text-tmuted">
                    {fmtWibDate(r.created_at)}
                    {r.emailed && <Mail size={12} strokeWidth={1.5} className="ml-1 inline text-tdim" aria-label="emailed" />}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs font-semibold text-tdim">
                <th className="pb-2 pr-4 text-left">WEEK</th>
                <th className="pb-2 pr-6 text-right">NET WORTH</th>
                <th className="pb-2 pr-6 text-right">WOW</th>
                <th className="pb-2 pr-6 text-right">RECS</th>
                <th className="pb-2 pr-6 text-right">ACCURACY</th>
                <th className="pb-2 pr-4 text-left">GENERATED</th>
                <th className="pb-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {reviews.map((r) => {
                const wow = r.stats?.wow_pct;
                return (
                  <tr key={r.id} className="border-t border-edge">
                    <td className="py-2 pr-4 font-medium text-tprimary">
                      <Link href={`/reviews?id=${r.id}`} className="hover:text-accent">
                        {r.week_start} → {r.week_end}
                      </Link>
                    </td>
                    <td className="num py-2 pr-6 text-right">
                      {r.stats?.net_worth != null ? fmtIdr(r.stats.net_worth) : "N/A"}
                    </td>
                    <td className="num py-2 pr-6 text-right">
                      <span className={wow == null ? "text-tdim" : wow >= 0 ? "text-up" : "text-down"}>
                        {pctStr(wow)}
                      </span>
                    </td>
                    <td className="num py-2 pr-6 text-right">{r.stats?.rec_changed ?? "—"}</td>
                    <td className="num py-2 pr-6 text-right">
                      {r.stats?.accuracy_pct != null
                        ? `${r.stats.accuracy_pct.toFixed(0)}% (n=${r.stats.accuracy_n ?? 0})`
                        : "—"}
                    </td>
                    <td className="py-2 pr-4 text-tdim">
                      <span className="inline-flex items-center gap-1.5">
                        {fmtWibDate(r.created_at)}
                        {r.emailed && <Mail size={12} strokeWidth={1.5} className="text-tdim" aria-label="emailed" />}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <Link href={`/reviews?id=${r.id}`} className="text-tdim hover:text-accent">
                        <ChevronRight size={15} strokeWidth={1.5} className="inline" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
