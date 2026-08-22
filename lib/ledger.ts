// Weighted-average ledger fold shared by web and app. Folds a chronological
// list of BUY/SELL lots into net position, average buy price, remaining cost
// basis, and realized P&L. A SELL never changes the average buy price; it
// realizes (sell − avg) × qty and reduces the open quantity. This mirrors the
// SQL recompute_stock_position() trigger used for the portfolio_positions cache.

export interface LedgerLot {
  side: 'BUY' | 'SELL'
  qty: number
  price: number
  at?: string
}

export interface LedgerResult {
  netQty: number
  avgBuy: number
  totalBuyCost: number
  realizedPnl: number
}

export function foldWeightedAvg(lots: LedgerLot[]): LedgerResult {
  let qty = 0
  let avg = 0
  let realized = 0
  for (const lot of lots) {
    if (lot.side === 'BUY') {
      const newQty = qty + lot.qty
      avg = newQty > 0 ? (avg * qty + lot.price * lot.qty) / newQty : 0
      qty = newQty
    } else {
      const sellQty = Math.min(lot.qty, qty)
      realized += (lot.price - avg) * sellQty
      qty -= sellQty
      if (qty === 0) avg = 0
    }
  }
  return { netQty: qty, avgBuy: avg, totalBuyCost: qty * avg, realizedPnl: realized }
}
