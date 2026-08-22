"use client";

import { useMemo, useState } from "react";
import { fmtIdr, fmtWibDate } from "@/lib/format";
import {
  type ChartRange, type ChartPoint,
  filterByRange, availableRanges, defaultRange,
} from "@/lib/chart";

const RANGES: ChartRange[] = ["1M", "3M", "6M", "1Y", "ALL"];
const W = 640;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 20, left: 8 };

export default function PriceChart({ points, avgCost }: { points: ChartPoint[]; avgCost?: number | null }) {
  const now = useMemo(() => new Date(), []);
  const avail = useMemo(() => availableRanges(points, now), [points, now]);
  const [range, setRange] = useState<ChartRange>(() => defaultRange(points, now));
  const [hover, setHover] = useState<number | null>(null);

  const view = useMemo(() => filterByRange(points, range, now), [points, range, now]);

  if (view.length < 2) {
    return <p className="text-sm text-tdim">Not enough price history yet.</p>;
  }

  const prices = view.map((p) => p.price);
  const lo = Math.min(...prices, ...(avgCost ? [avgCost] : []));
  const hi = Math.max(...prices, ...(avgCost ? [avgCost] : []));
  const span = hi - lo || 1;

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / (view.length - 1)) * innerW;
  const y = (p: number) => PAD.top + (1 - (p - lo) / span) * innerH;

  const line = view.map((p, i) => `${x(i)},${y(p.price)}`).join(" ");
  const area = `${PAD.left},${PAD.top + innerH} ${line} ${PAD.left + innerW},${PAD.top + innerH}`;
  const up = view[view.length - 1].price >= view[0].price;
  const stroke = up ? "var(--color-up)" : "var(--color-down)";

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD.left) / innerW) * (view.length - 1));
    setHover(Math.max(0, Math.min(view.length - 1, i)));
  }

  const hp = hover != null ? view[hover] : null;

  return (
    <div>
      <div className="mb-2 flex gap-1">
        {RANGES.map((r) => {
          const ok = avail.includes(r);
          const active = r === range;
          return (
            <button
              key={r}
              disabled={!ok}
              onClick={() => { setRange(r); setHover(null); }}
              className={`rounded-md px-2 py-1 text-xs ${active ? "bg-component text-tprimary" : "text-tmuted hover:text-tprimary"} disabled:cursor-not-allowed disabled:opacity-30`}
            >
              {r}
            </button>
          );
        })}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        preserveAspectRatio="none"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <polygon points={area} fill={stroke} opacity={0.08} />
        <polyline points={line} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        {avgCost != null && avgCost >= lo && avgCost <= hi && (
          <line
            x1={PAD.left} x2={PAD.left + innerW} y1={y(avgCost)} y2={y(avgCost)}
            stroke="var(--color-tmuted, #888)" strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" opacity={0.6}
          />
        )}
        {hp && (
          <>
            <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--color-edge, #333)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <circle cx={x(hover!)} cy={y(hp.price)} r={3} fill={stroke} />
          </>
        )}
      </svg>

      <div className="mt-1 flex justify-between text-[11px] text-tdim">
        <span>{fmtWibDate(view[0].t)}</span>
        {hp ? (
          <span className="num text-tsecondary">{fmtWibDate(hp.t)} · {fmtIdr(hp.price)}</span>
        ) : (
          <span className="num">{fmtIdr(lo)} - {fmtIdr(hi)}</span>
        )}
        <span>{fmtWibDate(view[view.length - 1].t)}</span>
      </div>
    </div>
  );
}
