export type ChartRange = "1M" | "3M" | "6M" | "1Y" | "ALL";
export interface ChartPoint { t: string; price: number; }

const MONTHS: Record<Exclude<ChartRange, "ALL">, number> = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12 };

export function rangeCutoff(range: ChartRange, now: Date): Date | null {
  if (range === "ALL") return null;
  const d = new Date(now);
  d.setMonth(d.getMonth() - MONTHS[range]);
  return d;
}

export function filterByRange(points: ChartPoint[], range: ChartRange, now: Date): ChartPoint[] {
  const cutoff = rangeCutoff(range, now);
  if (!cutoff) return points;
  const ms = cutoff.getTime();
  return points.filter((p) => new Date(p.t).getTime() >= ms);
}

// Ranges that hold at least 2 points given the data (so the toggle can grey out
// ranges that would render an empty or single-point chart).
export function availableRanges(points: ChartPoint[], now: Date): ChartRange[] {
  const all: ChartRange[] = ["1M", "3M", "6M", "1Y", "ALL"];
  return all.filter((r) => filterByRange(points, r, now).length >= 2);
}

// Default 6M; if the full history spans less than 6 months, default to ALL.
export function defaultRange(points: ChartPoint[], now: Date): ChartRange {
  if (points.length < 2) return "ALL";
  const oldest = new Date(points[0].t).getTime();
  const sixMonthsAgo = rangeCutoff("6M", now)!.getTime();
  return oldest <= sixMonthsAgo ? "6M" : "ALL";
}
