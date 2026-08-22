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

export function enabledPersonas(): PersonaDef[] {
  const raw = process.env.PERSONAS?.trim()
  if (!raw) return Object.values(PERSONAS)
  // Numeric value = take the first N personas in definition order
  if (/^\d+$/.test(raw)) {
    const n = Math.max(1, Math.min(Number(raw), Object.keys(PERSONAS).length))
    return Object.values(PERSONAS).slice(0, n)
  }
  const picked: PersonaDef[] = []
  for (const key of raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) {
    const def = PERSONAS[key]
    if (def) picked.push(def)
    else console.warn(`[personas] unknown persona '${key}' — skipped`)
  }
  return picked.length > 0 ? picked : Object.values(PERSONAS)
}

const fmt = (n: number | null | undefined, digits = 1): string =>
  n == null ? 'n/a' : n.toFixed(digits)

export function buildPersonaPrompt(
  persona: PersonaDef,
  payload: DeepRunPayload,
): { system: string; user: string } {
  const display = payload.ticker.replace('.JK', '')
  const s = payload.scores

  const system =
    `You are ${persona.name}, evaluating an Indonesian (IDX) stock.\n` +
    `Investment philosophy: ${persona.style}\n` +
    `Judge strictly through this philosophy. Respond with ONLY a JSON object:\n` +
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
    ``,
    `ANALYST SCORES (each -100 bearish .. +100 bullish):`,
    `- Technical ${s.technical.score}: ${s.technical.rationale}`,
    `- Valuation ${s.valuation.score}: ${s.valuation.rationale}`,
    `- Sentiment ${s.sentiment.score}: ${s.sentiment.rationale}`,
    `- Momentum ${s.momentum.score}: ${s.momentum.rationale}`,
    `- Composite: ${s.composite}`,
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
