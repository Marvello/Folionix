import type { AnalystScores } from './scores'
import type { DeepRunPayload, PersonaResult } from './personas'
import { PERSONAS } from './personas'

// ── CONSENSUS ───────────────────────────────────────────────────────────────
// Deterministic aggregation of persona verdicts + analyst scores into the
// final recommendation keyword. The LLM only renders the prose report — the
// verdict itself is decided here, so extractRecommendation always reflects
// the actual consensus regardless of what the model writes.

export interface PersonaVote extends PersonaResult {
  persona: string
}

/** Confidence-weighted net signal: -100 (bearish) .. 100 (bullish).
 *  70% persona vote, 30% deterministic composite. */
export function aggregateSignals(votes: PersonaVote[], scores: AnalystScores): number {
  if (votes.length === 0) return scores.composite
  const dir = (s: PersonaVote['signal']): number =>
    s === 'bullish' ? 1 : s === 'bearish' ? -1 : 0
  const personaNet = votes.reduce((a, v) => a + dir(v.signal) * v.confidence, 0) / votes.length
  return Math.round(0.7 * personaNet + 0.3 * scores.composite)
}

/** Map the net signal onto the existing recommendation keyword set, split by
 *  held vs watchlist context (mirrors the prompt-template split). */
export function mapToRecommendation(net: number, held: boolean, pnlPct: number | null): string {
  if (!held) {
    if (net >= 40) return 'BUY'
    if (net >= 15) return 'MONITOR'
    return 'HOLD'
  }
  const inLoss = pnlPct != null && pnlPct < -2
  const inProfit = pnlPct != null && pnlPct > 2
  if (net >= 40) return inLoss ? 'AVERAGE DOWN' : 'BUY'
  if (net >= -15) return 'HOLD'
  if (net > -40) return inProfit ? 'TRIM' : 'MONITOR'
  return inLoss ? 'CUT LOSS' : 'TAKE PROFIT'
}

const fmt = (n: number | null | undefined, digits = 1): string =>
  n == null ? 'n/a' : n.toFixed(digits)

export function buildConsensusPrompt(
  payload: DeepRunPayload,
  votes: PersonaVote[],
  decidedRec: string,
): { system: string; user: string } {
  const display = payload.ticker.replace('.JK', '')
  const s = payload.scores

  const system =
    `You are the portfolio manager of a multi-agent analyst desk covering IDX stocks. ` +
    `Your analyst personas have voted; the final verdict is already decided: ${decidedRec}. ` +
    `Write the client-facing summary that explains this consensus.\n` +
    `FORMAT: Telegram HTML only — tags <b>, <i>, <code> only. No Markdown, no code fences. Maximum 200 words.`

  const voteLines = votes.map(v => {
    const name = PERSONAS[v.persona]?.name ?? v.persona
    return `- ${name}: ${v.signal.toUpperCase()} (${v.confidence}%) — ${v.reasoning}`
  })

  const user = [
    `STOCK: ${display} (IDX) @ Rp ${fmt(payload.price, 0)} (day ${fmt(payload.day_change_pct)}%)`,
    payload.held
      ? `POSITION: held — ${payload.lots} lots @ avg Rp ${fmt(payload.avg_price, 0)}, P&L ${fmt(payload.pnl_pct)}%`
      : `POSITION: not held (watchlist candidate)`,
    ``,
    `ANALYST SCORES: technical ${s.technical.score}, valuation ${s.valuation.score}, ` +
    `sentiment ${s.sentiment.score}, momentum ${s.momentum.score}, composite ${s.composite}`,
    ``,
    `PERSONA VOTES:`,
    ...voteLines,
    ``,
    `FINAL VERDICT (already decided — do not change it): ${decidedRec}`,
    ``,
    `REQUIRED FORMAT:`,
    ``,
    `<b>${display} — Multi-Agent Consensus</b>`,
    ``,
    `<b>🗳 Vote</b>`,
    `[1-2 sentences: how the personas split and which camp carried the vote]`,
    ``,
    `<b>💡 Thesis</b>`,
    `[2-3 sentences: the strongest reasoning behind the consensus, naming 1-2 personas]`,
    ``,
    `<b>⚠️ Dissent</b>`,
    `[1 sentence: the strongest opposing view, named]`,
    ``,
    `REKOMENDASI: ${decidedRec}`,
  ].join('\n')

  return { system, user }
}

/** Guarantee the rendered report carries the decided keyword: strip any
 *  REKOMENDASI lines the model wrote and append the authoritative one. */
export function enforceRecommendation(raw: string, decidedRec: string): string {
  const stripped = raw
    .split('\n')
    .filter(line => !/^\s*REKOMENDASI\b/i.test(line))
    .join('\n')
    .trimEnd()
  return `${stripped}\n\nREKOMENDASI: ${decidedRec}`
}
