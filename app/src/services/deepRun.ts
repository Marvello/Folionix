import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import {
  enqueueAnalysisJobs, hasActiveRun, loadPortfolio, saveSnapshot,
  getLatestSentiment, getLastAlertedAnalysis, saveAnalysis, markAnalysisSent, getKeyStats, getValuation,
  savePersonaAnalysis, getRunPersonaResults,
} from '../db/db'
import { fetchStock } from '../providers/market'
import { computeTickerIndicators } from './portfolio'
import { computeAnalystScores } from '../ai/scores'
import {
  enabledPersonas, PERSONAS, buildPersonaPrompt, parsePersonaResult,
  type DeepRunPayload,
} from '../ai/personas'
import {
  aggregateSignals, mapToRecommendation, buildConsensusPrompt,
  enforceRecommendation, type PersonaVote,
} from '../ai/consensus'
import { callLlmWithModel, cleanForTelegram, extractRecommendation, HELD_RECOMMENDATIONS, WATCHLIST_RECOMMENDATIONS } from '../ai/llm'
import { sendTelegram } from '../telegram/client'
import { ALERT_FOOTER, evaluateAlert } from '../telegram/alerts'
import { normalizeTicker } from '../../../lib/format'
import type { AnalysisJobRow } from '../../../lib/types'

// ── DEEP RUN (multi-agent) ──────────────────────────────────────────────────
// One deep run = N persona jobs + 1 consensus job sharing a run_id, drained
// serially by the worker. Deterministic scores are computed once at enqueue
// time and carried in the job payload so every persona judges identical data.

const SEND_TELEGRAM = process.env.SEND_TELEGRAM !== 'false'

/** "4🟢 1⚪ 1🔴" — readable vote split for the alert header (a raw net score isn't). */
export function voteSplit(votes: { signal: string }[]): string {
  const n = (s: string) => votes.filter(v => v.signal === s).length
  return `${n('bullish')}🟢 ${n('neutral')}⚪ ${n('bearish')}🔴`
}

export async function enqueueDeepRun(ticker: string): Promise<boolean> {
  const jk = normalizeTicker(ticker)

  if (await hasActiveRun(jk)) {
    console.log(`[deeprun] ${jk}: active run in queue — skipped`)
    return false
  }

  const portfolio = await loadPortfolio()
  const pos = portfolio[jk]
  const snap = await fetchStock(jk, pos?.avg_price ?? 0, pos?.lots ?? 0, pos?.notes ?? null)
  const snapshotId = await saveSnapshot(snap)

  const [indicators, news, ks, valuation] = await Promise.all([
    computeTickerIndicators(jk),
    getLatestSentiment(jk),
    getKeyStats(jk),
    getValuation(jk),
  ])
  const scores = computeAnalystScores(snap, indicators, news?.score ?? null, valuation?.result ?? null)

  const personas = enabledPersonas()
  const payload: DeepRunPayload = {
    snapshot_id: snapshotId,
    ticker: jk,
    held: !!pos,
    lots: pos?.lots ?? 0,
    avg_price: pos?.avg_price ?? 0,
    pnl_pct: snap.unrealized_pnl_pct ?? null,
    price: snap.current_price,
    day_change_pct: snap.day_change_pct,
    pe: snap.pe,
    pb: snap.pb,
    div_yield_pct: snap.div_yield_pct,
    dist_from_high: snap.dist_from_high ?? null,
    dist_from_low: snap.dist_from_low ?? null,
    scores,
    key_stats: ks
      ? {
          forward_pe: ks.forward_pe ?? null, peg_ratio: ks.peg_ratio ?? null,
          return_on_equity: ks.return_on_equity ?? null, profit_margins: ks.profit_margins ?? null,
          revenue_growth: ks.revenue_growth ?? null, earnings_growth: ks.earnings_growth ?? null,
          current_ratio: ks.current_ratio ?? null, free_cashflow: ks.free_cashflow ?? null,
        }
      : null,
    valuation: valuation?.summary ?? null,
    news: news
      ? { score: news.score, themes: news.themes ?? null, catalyst: news.catalyst ?? null, risk: news.risk ?? null }
      : null,
  }

  const runId = randomUUID()
  const jobs: AnalysisJobRow[] = personas.map(p => ({
    ticker: jk, kind: 'persona' as const, persona: p.key, run_id: runId, payload,
  }))
  jobs.push({
    ticker: jk, kind: 'consensus', run_id: runId,
    payload: { ...payload, expected_personas: personas.length },
  })
  const inserted = await enqueueAnalysisJobs(jobs)
  if (!inserted) {
    console.log(`[deeprun] ${jk}: active run created concurrently — skipped`)
    return false
  }
  console.log(`[deeprun] ${jk}: enqueued ${personas.length} persona jobs + consensus (run ${runId.slice(0, 8)})`)
  return true
}

// ── JOB HANDLERS (invoked by graph/worker.ts) ──

export async function handlePersonaJob(job: AnalysisJobRow): Promise<Record<string, unknown>> {
  const def = PERSONAS[job.persona ?? '']
  if (!def) throw new Error(`unknown persona '${job.persona}'`)
  const payload = job.payload as unknown as DeepRunPayload
  if (!payload?.scores) throw new Error('job payload missing scores')

  const { system, user } = buildPersonaPrompt(def, payload)
  // Temperature 0: the vote decides the verdict, so sampling noise must not flip it.
  const { text: raw, model } = await callLlmWithModel(user, { system, temperature: 0, maxOutputTokens: 400 })
  const result = parsePersonaResult(raw)
  if (!result) throw new Error(`unparseable persona output: ${raw.slice(0, 120)}`)

  await savePersonaAnalysis({
    run_id: job.run_id,
    snapshot_id: payload.snapshot_id,
    ticker: job.ticker,
    persona: def.key,
    signal: result.signal,
    confidence: result.confidence,
    reasoning: result.reasoning,
    model,
  })
  return { ...result }
}

export async function handleConsensusJob(job: AnalysisJobRow): Promise<Record<string, unknown>> {
  const payload = job.payload as unknown as DeepRunPayload & { expected_personas?: number }
  if (!payload?.scores) throw new Error('job payload missing scores')

  const rows = await getRunPersonaResults(job.run_id)
  const expected = payload.expected_personas ?? rows.length
  const minRequired = Number(process.env.CONSENSUS_MIN_PERSONAS ?? Math.ceil(expected / 2))
  if (rows.length < minRequired) {
    throw new Error(`only ${rows.length}/${expected} persona results (need ${minRequired})`)
  }

  const votes: PersonaVote[] = rows.map(r => ({
    persona: r.persona, signal: r.signal, confidence: r.confidence, reasoning: r.reasoning ?? '',
  }))
  const net = aggregateSignals(votes, payload.scores)
  const decidedRec = mapToRecommendation(net, payload.held, payload.pnl_pct)

  const { system, user } = buildConsensusPrompt(payload, votes, decidedRec)
  const { text: rendered, model } = await callLlmWithModel(user, { system })
  const raw = enforceRecommendation(rendered, decidedRec)
  const cleanHtml = cleanForTelegram(raw)
  const recommendation = extractRecommendation(raw, payload.held ? HELD_RECOMMENDATIONS : WATCHLIST_RECOMMENDATIONS)

  const alertEval = evaluateAlert(await getLastAlertedAnalysis(job.ticker), recommendation, new Date())
  // Deep runs are signal-triggered, but a repeat of the same verdict on the
  // same WIB day carries no new information — only alert on a changed
  // recommendation or the first run of a new day.
  // Save before sending and flag `sent` after: a crash between the two leaves an
  // unsent row (re-alerted on retry via last-alerted dedup), never a silent loss.
  const analysisId = await saveAnalysis(
    payload.snapshot_id, job.ticker, `consensus:${model}`,
    raw, cleanHtml, recommendation, false, alertEval.isSame,
  )
  const header = `<b>${job.ticker.replace('.JK', '')}</b> — ${recommendation} (${voteSplit(votes)})\n\n`
  if (SEND_TELEGRAM && !alertEval.isSame && await sendTelegram(header + cleanHtml + ALERT_FOOTER)) {
    await markAnalysisSent(analysisId)
  }
  return { net, recommendation, votes: votes.length }
}
