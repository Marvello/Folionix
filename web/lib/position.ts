import type { Position, StockDividend } from "@/lib/types";

const SHARES_PER_LOT = 100;

export interface PositionMetrics {
  lots: number;
  avgPrice: number;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPct: number | null;
  realized: number;
  income: number;
  totalReturn: number;
}

// Derives a holding's numbers from the position row, latest price, and its
// dividends. When there is no live price, market value and unrealized P&L are
// 0 and the percentage is null (shown as N/A), never a misleading number.
export function positionMetrics(
  position: Position,
  currentPrice: number | null,
  dividends: StockDividend[],
): PositionMetrics {
  const lots = position.lots ?? 0;
  const avgPrice = position.avg_price ?? 0;
  const qty = lots * SHARES_PER_LOT;
  const costBasis = avgPrice && qty ? avgPrice * qty : 0;
  // Coerce to a plain number so downstream math never sees null (tsc-safe).
  const cur = currentPrice != null && currentPrice > 0 ? currentPrice : 0;
  const marketValue = cur && qty ? cur * qty : 0;
  const unrealizedPnl = cur && costBasis ? marketValue - costBasis : 0;
  const unrealizedPct = cur && costBasis ? (unrealizedPnl / costBasis) * 100 : null;
  const realized = position.realized_pnl ?? 0;
  const income = dividends.reduce((s, d) => s + (d.amount || 0), 0);
  const totalReturn = unrealizedPnl + realized + income;
  return { lots, avgPrice, costBasis, marketValue, unrealizedPnl, unrealizedPct, realized, income, totalReturn };
}
