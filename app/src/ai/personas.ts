import { extractJson } from './llm'
import type { AnalystScores } from './scores'

// ── INVESTOR PERSONAS ───────────────────────────────────────────────────────
// Multi-agent layer ported from the ai-hedge-fund architecture: each enabled
// persona is one LLM call that judges a compact, pre-digested payload and
// returns a structured verdict. Persona count is tunable via the PERSONAS env
// var so the serial local Ollama budget stays controllable.

export interface PersonaDef {
  key: string
  name: string
  style: string
}

export interface DeepRunPayload {
  snapshot_id: number
  ticker: string
  held: boolean
  lots: number
  avg_price: number
  pnl_pct: number | null
  price: number | null
  day_change_pct: number | null
  pe: number | null
  pb: number | null
  div_yield_pct: number | null
  dist_from_high: number | null
  dist_from_low: number | null
  scores: AnalystScores
  /** Yahoo key statistics; ratios are fractions (0.15 = 15%) as stored in stock_key_stats. */
  key_stats?: {
    forward_pe: number | null; peg_ratio: number | null; return_on_equity: number | null
    profit_margins: number | null; revenue_growth: number | null; earnings_growth: number | null
    current_ratio: number | null; free_cashflow: number | null
  } | null
  news: { score: number; themes: string | null; catalyst: string | null; risk: string | null } | null
  [key: string]: unknown
}

export interface PersonaResult {
  signal: 'bullish' | 'neutral' | 'bearish'
  confidence: number   // 0-100
  reasoning: string
}

export const PERSONAS: Record<string, PersonaDef> = {
  buffett: {
    key: 'buffett', name: 'Warren Buffett',
    style: 'Seeks wonderful businesses at fair prices: durable competitive moats, consistent earnings power, high return on equity, honest management. Prefers holding forever; price volatility is opportunity, not risk. Wary of businesses he cannot understand.',
  },
  munger: {
    key: 'munger', name: 'Charlie Munger',
    style: 'Demands quality above all: great businesses compound; mediocre ones destroy time. Uses inversion — first asks how this investment could fail. Deeply skeptical of hype, leverage, and managers who overpromise.',
  },
  graham: {
    key: 'graham', name: 'Benjamin Graham',
    style: 'Strict value discipline: buy only with a margin of safety — low P/E, price below tangible book, strong balance sheet. Mr. Market\'s mood swings are to be exploited, never followed. Speculative growth stories are not investments.',
  },
  damodaran: {
    key: 'damodaran', name: 'Aswath Damodaran',
    style: 'Values companies from first principles: cash flows, growth, and risk drive intrinsic value; narrative must reconcile with numbers. Distrusts multiples used without context. Will buy any asset when price sits below a defensible valuation.',
  },
  burry: {
    key: 'burry', name: 'Michael Burry',
    style: 'Deep-value contrarian: hunts hated, ignored, or misunderstood assets trading far below intrinsic worth. Obsessive about downside and balance-sheet reality. Comfortable being early and alone against consensus.',
  },
  lynch: {
    key: 'lynch', name: 'Peter Lynch',
    style: 'Growth at a reasonable price: earnings growth versus P/E (PEG) is the core test. Favors understandable businesses whose products are visibly winning. Categorizes stocks (stalwart, fast grower, cyclical, turnaround) and sizes expectations accordingly.',
  },
  fisher: {
    key: 'fisher', name: 'Phil Fisher',
    style: 'Buys outstanding growth companies and holds for decades: superior R&D, expanding margins, sales organization strength, management depth. Scuttlebutt over screens. Sells almost never — only when the business itself deteriorates.',
  },
  wood: {
    key: 'wood', name: 'Cathie Wood',
    style: 'Backs disruptive innovation with exponential adoption curves: technology platforms, network effects, five-year horizons. Accepts extreme volatility and rich near-term multiples when the addressable market is expanding by orders of magnitude.',
  },
  ackman: {
    key: 'ackman', name: 'Bill Ackman',
    style: 'Concentrated activist bets on simple, predictable, free-cash-flow-generative businesses with pricing power. Looks for a catalyst — management change, restructuring, re-rating — and holds with high conviction through noise.',
  },
  pabrai: {
    key: 'pabrai', name: 'Mohnish Pabrai',
    style: 'Dhandho investor: heads I win, tails I don\'t lose much. Clones proven ideas, waits for rare no-brainer setups with asymmetric payoff, and otherwise does nothing. Low P/E, low downside, simple thesis expressible in one paragraph.',
  },
  jhunjhunwala: {
    key: 'jhunjhunwala', name: 'Rakesh Jhunjhunwala',
    style: 'Emerging-market bull: rides structural domestic-growth stories — consumption, banking, infrastructure — with conviction and patience. Buys fear, respects market trends, and sizes up when the macro tailwind and the balance sheet agree.',
  },
  druckenmiller: {
    key: 'druckenmiller', name: 'Stanley Druckenmiller',
    style: 'Macro-momentum trader: capital concentrates where the liquidity and the trend already point. Never fights the tape; cuts losers instantly, presses winners aggressively. Positioning and rate environment outweigh valuation.',
  },
}

// Style-interleaved order (value, contrarian, growth, macro, …) so any prefix is
// balanced: PERSONAS=N used to take the first N in definition order — all value
// investors. The first six are the default: the remaining six largely duplicate
// them on the data the payload carries (Buffett≈Munger, Graham≈Pabrai, Lynch≈Fisher).
const BALANCED_ORDER = [
  'buffett', 'burry', 'lynch', 'druckenmiller', 'graham', 'wood',
  'damodaran', 'munger', 'fisher', 'ackman', 'pabrai', 'jhunjhunwala',
]
const DEFAULT_COUNT = 6

export function enabledPersonas(): PersonaDef[] {
  const raw = process.env.PERSONAS?.trim().toLowerCase()
  const ordered = BALANCED_ORDER.map(k => PERSONAS[k])
  if (!raw) return ordered.slice(0, DEFAULT_COUNT)
  if (raw === 'all') return ordered
  if (/^\d+$/.test(raw)) {
    const n = Math.max(1, Math.min(Number(raw), ordered.length))
    return ordered.slice(0, n)
  }
  const picked: PersonaDef[] = []
  for (const key of raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
    const def = PERSONAS[key]
    if (def) picked.push(def)
    else console.warn(`[personas] unknown persona '${key}' — skipped`)
  }
  return picked.length > 0 ? picked : ordered.slice(0, DEFAULT_COUNT)
}

const fmt = (n: number | null | undefined, digits = 1): string =>
  n == null ? 'n/a' : n.toFixed(digits)

/** Yahoo stores ratios as fractions; render them as percents. */
const pct = (n: number | null | undefined): string => (n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`)

function keyStatsLine(k: DeepRunPayload['key_stats']): string {
  if (!k) return 'KEY STATS: n/a'
  const fcf = k.free_cashflow == null ? 'n/a' : `Rp ${(k.free_cashflow / 1e9).toFixed(1)}B`
  return `KEY STATS: forward P/E ${fmt(k.forward_pe)}, PEG ${fmt(k.peg_ratio, 2)}, ROE ${pct(k.return_on_equity)}, ` +
    `net margin ${pct(k.profit_margins)}, revenue growth ${pct(k.revenue_growth)}, earnings growth ${pct(k.earnings_growth)}, ` +
    `current ratio ${fmt(k.current_ratio, 2)}, free cash flow ${fcf}`
}

export function buildPersonaPrompt(
  persona: PersonaDef,
  payload: DeepRunPayload,
): { system: string; user: string } {
  const display = payload.ticker.replace('.JK', '')
  const s = payload.scores

  const system =
    `You are ${persona.name}, evaluating an Indonesian (IDX) stock.\n` +
    `Investment philosophy: ${persona.style}\n` +
    `Judge strictly through this philosophy.\n` +
    `Use ONLY the data provided; do not rely on anything you remember about this company.\n` +
    `If your philosophy depends on data that is missing (n/a), say so in your reasoning and cap confidence at 50.\n` +
    `Confidence: 80-100 = several provided data points strongly agree; 50-79 = mixed; below 50 = thin or missing data.\n` +
    `Respond with ONLY a JSON object:\n` +
    `{"signal": "bullish" | "neutral" | "bearish", "confidence": 0-100, "reasoning": "<2-3 sentences>"}`

  const lines = [
    `STOCK: ${display} (IDX)`,
    payload.held
      ? `POSITION: held — ${payload.lots} lots @ avg Rp ${fmt(payload.avg_price, 0)}, P&L ${fmt(payload.pnl_pct)}%`
      : `POSITION: not held (watchlist candidate)`,
    ``,
    `PRICE: Rp ${fmt(payload.price, 0)} (day ${fmt(payload.day_change_pct)}%)`,
    `52W RANGE: ${fmt(payload.dist_from_high)}% from high, ${fmt(payload.dist_from_low)}% from low`,
    `FUNDAMENTALS: P/E ${fmt(payload.pe)}, P/B ${fmt(payload.pb)}, dividend yield ${fmt(payload.div_yield_pct)}%`,
    keyStatsLine(payload.key_stats),
    ``,
    `ANALYST SCORES (each -100 bearish .. +100 bullish):`,
    `- Technical ${s.technical.score}: ${s.technical.rationale}`,
    `- Valuation ${s.valuation.score}: ${s.valuation.rationale}`,
    `- Sentiment ${s.sentiment.score}: ${s.sentiment.rationale}`,
    `- Momentum ${s.momentum.score}: ${s.momentum.rationale}`,
    // No composite line: personas anchored on it instead of applying their own lens.
  ]
  if (payload.news) {
    lines.push(
      ``,
      `NEWS (score ${payload.news.score} of ±5):`,
      `- Themes: ${payload.news.themes ?? 'n/a'}`,
      `- Catalyst: ${payload.news.catalyst ?? 'n/a'}`,
      `- Risk: ${payload.news.risk ?? 'n/a'}`,
    )
  }
  lines.push(``, `Give your verdict as JSON only.`)

  return { system, user: lines.join('\n') }
}

export function parsePersonaResult(raw: string): PersonaResult | null {
  const parsed = extractJson(raw)
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>

  const signal = typeof obj.signal === 'string' ? obj.signal.toLowerCase().trim() : ''
  if (signal !== 'bullish' && signal !== 'neutral' && signal !== 'bearish') return null

  const confRaw = typeof obj.confidence === 'number' ? obj.confidence : Number(obj.confidence)
  if (!Number.isFinite(confRaw)) return null
  const confidence = Math.max(0, Math.min(100, Math.round(confRaw)))

  const reasoning = typeof obj.reasoning === 'string' ? obj.reasoning.trim() : ''

  return { signal, confidence, reasoning }
}
