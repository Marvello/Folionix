// Inline trend lines. Brand: prefer sparklines inside list rows so a row
// communicates trend at a glance, and color uses market-semantic tokens.

function path(prices: number[], w: number, h: number): string {
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  return prices
    .map((p, i) => `${(i / (prices.length - 1)) * w},${h - ((p - min) / span) * h}`)
    .join(" ");
}

/** Full-width sparkline for detail pages. */
export function Sparkline({ prices }: { prices: number[] }) {
  if (prices.length < 2) return <p className="text-sm text-tdim">Not enough data.</p>;
  const w = 600;
  const h = 80;
  const up = prices[prices.length - 1] >= prices[0];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" height={80}>
      <polyline
        points={path(prices, w, h)}
        fill="none"
        stroke={up ? "var(--color-up)" : "var(--color-down)"}
        strokeWidth={2}
      />
    </svg>
  );
}

/** Tiny inline sparkline for table rows. */
export function MiniSparkline({ prices }: { prices: number[] | undefined }) {
  if (!prices || prices.length < 2) return <span className="text-tdim">—</span>;
  const w = 64;
  const h = 20;
  const up = prices[prices.length - 1] >= prices[0];
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      preserveAspectRatio="none"
      aria-hidden
      className="inline-block align-middle"
    >
      <polyline
        points={path(prices, w, h)}
        fill="none"
        stroke={up ? "var(--color-up)" : "var(--color-down)"}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
