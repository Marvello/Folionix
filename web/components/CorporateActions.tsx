import type { CorporateActionRow } from "@/lib/types";
import { fmtIdr, fmtWibDate } from "@/lib/format";
import EmptyState from "./EmptyState";

const TYPE_LABEL: Record<CorporateActionRow["type"], string> = {
  DIVIDEND: "Dividend",
  SPLIT: "Split",
  RIGHTS: "Rights issue",
  BONUS: "Bonus shares",
  RUPS: "Shareholder meeting",
};

function describe(a: CorporateActionRow): string {
  if (a.type === "DIVIDEND") {
    const pay = typeof a.details.pay_date === "string" ? a.details.pay_date : null;
    const amount = a.amount == null ? "amount not announced" : `${fmtIdr(a.amount)} per share`;
    return pay ? `${amount}, paid ${fmtWibDate(pay)}` : amount;
  }
  if (a.type === "SPLIT" && a.ratio != null) {
    return a.ratio >= 1
      ? `1 share becomes ${a.ratio}`
      : `${Math.round(1 / a.ratio)} shares become 1`;
  }
  return a.source;
}

export default function CorporateActions({ rows }: { rows: CorporateActionRow[] }) {
  if (rows.length === 0) {
    return <EmptyState message="No corporate actions recorded for this ticker." />;
  }
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = rows.filter((r) => r.event_date >= today);
  const past = rows.filter((r) => r.event_date < today);

  const List = ({ items, heading }: { items: CorporateActionRow[]; heading: string }) =>
    items.length === 0 ? null : (
      <div>
        <div className="mb-1.5 text-xs text-tdim">{heading}</div>
        <ul className="divide-y divide-edge/50">
          {items.map((a) => (
            <li key={`${a.type}-${a.event_date}`} className="flex items-baseline gap-3 py-2">
              <span className="num w-24 shrink-0 text-xs text-tdim">{fmtWibDate(a.event_date)}</span>
              <span className="w-36 shrink-0 text-sm text-tprimary">{TYPE_LABEL[a.type]}</span>
              <span className="text-sm text-tsecondary">{describe(a)}</span>
            </li>
          ))}
        </ul>
      </div>
    );

  return (
    <section>
      <h2 className="mb-3 font-semibold text-tprimary">Corporate Actions</h2>
      <div className="space-y-4">
        <List items={upcoming.slice().reverse()} heading="Upcoming" />
        <List items={past} heading="Past" />
      </div>
    </section>
  );
}
