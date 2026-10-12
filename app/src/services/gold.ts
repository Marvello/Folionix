// app/src/services/gold.ts
import {
  getGoldPurchases, addGoldPurchase, deactivateGoldPurchase,
  saveGoldSnapshot, getLatestGoldMids,
} from '../db/db'
import { fetchGoldPrices, type GoldPriceResult } from '../providers/cermati'
import { sendTelegram } from '../telegram/client'
import { foldWeightedAvg, type LedgerLot } from '../../../lib/ledger'
import { fmtIdr, escapeHtml } from '../../../lib/format'
import type { GoldPurchaseRow } from '../../../lib/types'

// Alert when mid price moves at least this % since the previous pull.
const GOLD_ALERT_PCT = Number(process.env.GOLD_ALERT_PCT ?? 3)
const SEND_TELEGRAM = process.env.SEND_TELEGRAM !== 'false'

export interface GoldHolding {
  venue: string
  grams: number            // net grams (buys − sells)
  avgBuyPrice: number      // weighted-average buy price/g
  cost: number             // remaining cost basis (net grams × avg)
  currentPrice: number | null
  currentValue: number | null
  unrealizedPnl: number | null
  unrealizedPnlPct: number | null
  realizedPnl: number
}

/**
 * Significant-move check: compare the new mid to the previous pull's mid.
 * Pure so it's unit-testable; returns null when there's nothing to compare.
 */
export function evaluateGoldAlert(
  prevMid: number | null,
  newMid: number | null,
  thresholdPct: number,
): { alert: boolean; pct: number; dir: 'up' | 'down' } | null {
  if (prevMid == null || newMid == null || prevMid <= 0) return null
  const pct = ((newMid - prevMid) / prevMid) * 100
  return { alert: Math.abs(pct) >= thresholdPct, pct, dir: pct >= 0 ? 'up' : 'down' }
}

async function maybeAlertGold(venue: string, r: GoldPriceResult, prevMid: number | null): Promise<void> {
  const newMid = r.mid ?? (r.buy + r.sell) / 2
  const ev = evaluateGoldAlert(prevMid, newMid, GOLD_ALERT_PCT)
  if (!ev?.alert) return
  const arrow = ev.dir === 'up' ? '🔺' : '🔻'
  const hint = ev.dir === 'up'
    ? 'Sell price climbing — consider selling.'
    : 'Price dropping — consider buying.'
  const msg =
    `🥇 <b>Gold (${escapeHtml(venue)})</b> mid ${arrow} ${ev.pct >= 0 ? '+' : ''}${ev.pct.toFixed(1)}% since last check\n` +
    `Buy ${fmtIdr(r.buy)}/g · Sell ${fmtIdr(r.sell)}/g\n` +
    `<i>${hint}</i>`
  if (SEND_TELEGRAM) await sendTelegram(msg)
}

export async function refreshGoldPrices(): Promise<void> {
  const prices = await fetchGoldPrices()
  const venues = Object.entries(prices)
  // Read the current mids before we overwrite "latest" with the new pull.
  const prevMids = await getLatestGoldMids()
  for (const [venue, result] of venues) {
    await saveGoldSnapshot(venue, result)
    await maybeAlertGold(venue, result, prevMids[venue] ?? null)
  }
  // An empty provider response used to log "refreshed 0 venues" and look like a
  // success, indistinguishable from "not due yet" when reading the log later.
  if (venues.length === 0) {
    console.warn('[gold] provider returned no venues — nothing written')
    return
  }
  console.log(
    `[gold] refreshed ${venues.length} venues: ` +
    venues.map(([v, r]) => `${v} buy=${r.buy} sell=${r.sell}`).join(', '),
  )
}

export async function listGoldHoldings(): Promise<{ holdings: GoldHolding[]; prices: Record<string, number> }> {
  const [purchases, rawPrices] = await Promise.all([
    getGoldPurchases(),
    fetchGoldPrices().catch(() => ({} as Awaited<ReturnType<typeof fetchGoldPrices>>)),
  ])
  const prices: Record<string, number> = {}
  for (const [venue, result] of Object.entries(rawPrices)) {
    prices[venue] = result.sell
  }

  // foldWeightedAvg needs chronological order; DB returns newest-first
  const sortedPurchases = [...purchases].sort((a, b) =>
    (a.purchased_at ?? '').localeCompare(b.purchased_at ?? '') || ((a.id ?? 0) - (b.id ?? 0)))

  const byVenue = new Map<string, GoldPurchaseRow[]>()
  for (const p of sortedPurchases) {
    const rows = byVenue.get(p.venue) ?? []
    rows.push(p)
    byVenue.set(p.venue, rows)
  }

  const holdings: GoldHolding[] = [...byVenue.entries()].map(([venue, rows]) => {
    const lots: LedgerLot[] = rows.map(p => ({
      side: p.side ?? 'BUY', qty: p.grams, price: p.buy_price_per_gram, at: p.purchased_at,
    }))
    const f = foldWeightedAvg(lots)
    const currentPrice = prices[venue.toLowerCase()] ?? null
    const currentValue = currentPrice != null ? f.netQty * currentPrice : null
    const unrealizedPnl = currentValue != null ? currentValue - f.totalBuyCost : null
    const unrealizedPnlPct = unrealizedPnl != null && f.totalBuyCost > 0
      ? (unrealizedPnl / f.totalBuyCost) * 100
      : null
    return {
      venue,
      grams: f.netQty,
      avgBuyPrice: f.avgBuy,
      cost: f.totalBuyCost,
      currentPrice,
      currentValue,
      unrealizedPnl,
      unrealizedPnlPct,
      realizedPnl: f.realizedPnl,
    }
  }).filter(h => h.grams > 1e-9 || h.realizedPnl !== 0)

  return { holdings, prices }
}

export { addGoldPurchase, deactivateGoldPurchase }
