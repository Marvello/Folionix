import 'dotenv/config'
import {
  loadPortfolio, upsertClassifications, getClassifications, replaceAllPeers, getAllPeers,
  syncPeerWatchlist, saveAnnualMultiples, getValuationInputs, saveValuation,
  type ClassificationRow, type PeerRow,
} from '../db/db.js'
import { fetchClassifications } from '../providers/idx.js'
import { fetchAnnualMultiples, fetchMarketCaps } from '../providers/market.js'
import { valuate, type ValuationInput } from '../ai/valuation.js'
import { refreshFundamentals } from './fundamentals.js'
import { runPriceRefresh } from './portfolio.js'
import { displayTicker } from '../../../lib/format.js'
import { mapPool } from '../utils/mapPool.js'

// ── PEER GROUPS ──
// Peers of each HOLDING (not of watchlist entries — no peers-of-peers): same IDX-IC
// sub-industry, widened to the industry when the sub-industry has < 3 other members,
// then the top PEERS_PER_GROUP by market cap so a large bank is compared with large banks.

export const PEERS_PER_GROUP = 8
const MIN_GROUP = 3
const CONCURRENCY = Math.max(1, Number(process.env.PROVIDER_CONCURRENCY) || 4)

/** Pure: pick each holding's peer group. Holdings without a classification get none. */
export function selectPeerGroups(holdings: string[], cls: ClassificationRow[], caps: Map<string, number>): PeerRow[] {
  const byTicker = new Map(cls.map((c) => [c.ticker, c]))
  const out: PeerRow[] = []
  for (const h of holdings) {
    const me = byTicker.get(h)
    if (!me) continue
    const sub = cls.filter((c) => c.ticker !== h && c.sub_industry && c.sub_industry === me.sub_industry)
    const [basis, group, members] = sub.length >= MIN_GROUP
      ? ['sub_industry', me.sub_industry!, sub] as const
      : ['industry', me.industry ?? '', cls.filter((c) => c.ticker !== h && c.industry && c.industry === me.industry)] as const
    members
      .filter((c) => caps.has(c.ticker))   // no market cap = not trading / no data: not a usable comparable
      .sort((a, b) => caps.get(b.ticker)! - caps.get(a.ticker)!)
      .slice(0, PEERS_PER_GROUP)
      .forEach((c, i) => out.push({ ticker: h, peer: c.ticker, rank: i + 1, basis, group_name: group }))
  }
  return out
}

/** Pure: watchlist reason per peer, e.g. "Peer of BBCA, BMRI · Bank". Held tickers are skipped. */
export function peerNotes(peers: PeerRow[], held: Set<string>): Map<string, string> {
  const of = new Map<string, { holdings: string[]; group: string }>()
  for (const p of peers) {
    if (held.has(p.peer)) continue
    const e = of.get(p.peer) ?? { holdings: [], group: p.group_name }
    e.holdings.push(displayTicker(p.ticker))
    of.set(p.peer, e)
  }
  return new Map([...of].map(([t, e]) => [t, `Peer of ${e.holdings.sort().join(', ')} · ${e.group}`]))
}

function toInput(r: Record<string, any>): ValuationInput {
  return {
    ticker: r.ticker, sector: r.sector ?? null, market_cap: r.market_cap, trailing_pe: r.trailing_pe,
    price_to_book: r.price_to_book, total_revenue: r.total_revenue, ebitda: r.ebitda, total_debt: r.total_debt,
    total_cash: r.total_cash, return_on_equity: r.return_on_equity, earnings_growth: r.earnings_growth,
    revenue_growth: r.revenue_growth, ebitda_margins: r.ebitda_margins, div_yield_pct: r.div_yield_pct,
    annual: Array.isArray(r.annual) ? r.annual : [],
  }
}

/** Daily: 3-way valuation for every holding with a peer group → stock_valuation. */
export async function computeValuations(): Promise<number> {
  const peers = await getAllPeers()
  const groups = new Map<string, string[]>()
  for (const p of peers) groups.set(p.ticker, [...(groups.get(p.ticker) ?? []), p.peer])
  if (groups.size === 0) return 0
  const all = [...new Set([...groups.keys(), ...peers.map((p) => p.peer)])]
  const inputs = new Map((await getValuationInputs(all)).map((r) => [r.ticker as string, toInput(r)]))
  let n = 0
  for (const [holding, list] of groups) {
    const stock = inputs.get(holding)
    if (!stock) continue
    const r = valuate(stock, list.map((t) => inputs.get(t)).filter((x): x is ValuationInput => !!x))
    await saveValuation(holding, r.lens, r.summary, r)
    n++
  }
  return n
}

/**
 * Weekly: refresh the IDX classification, recompute peer groups, sync the
 * watchlist's `peer` rows, refresh own-history multiples, then value everything.
 */
export async function refreshPeers(): Promise<{ classified: number; peers: number; added: number; removed: number; valued: number }> {
  const cls = await fetchClassifications()
  await upsertClassifications(cls)

  const holdings = Object.keys(await loadPortfolio())
  const byTicker = new Map(cls.map((c) => [c.ticker, c]))
  const candidates = cls.filter((c) => holdings.some((h) => {
    const me = byTicker.get(h)
    return me && (c.sub_industry === me.sub_industry || c.industry === me.industry)
  })).map((c) => c.ticker)
  const caps = await fetchMarketCaps(candidates)

  const groups = selectPeerGroups(holdings, await getClassifications(), caps)
  await replaceAllPeers(groups)
  const { added, removed } = await syncPeerWatchlist(peerNotes(groups, new Set(holdings)))

  const peerTickers = [...new Set(groups.map((g) => g.peer))]
  const everyone = [...new Set([...holdings, ...peerTickers])]
  // Key stats for holdings AND peers now (not at tonight's sweep), so every multiple
  // is computed from the same, fresh inputs.
  await refreshFundamentals(everyone)
  // Prices too, so newly added peers show in the dashboard before the next runner cycle.
  await runPriceRefresh(peerTickers)
  await mapPool(everyone, CONCURRENCY, async (t) => saveAnnualMultiples(t, await fetchAnnualMultiples(t)))

  const valued = await computeValuations()
  return { classified: cls.length, peers: groups.length, added, removed, valued }
}

// ── CLI: `npm run peers` ──
if (process.argv[1]?.endsWith('peers.ts') || process.argv[1]?.endsWith('peers.js')) {
  refreshPeers()
    .then((r) => console.log('[peers]', r))
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error('[peers]', err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
