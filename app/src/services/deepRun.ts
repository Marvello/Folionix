import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import {
  enqueueAnalysisJobs, hasActiveRun, loadPortfolio, saveSnapshot,
  getLatestSentiment, getLatestAnalysis, saveAnalysis,
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
import { callLlm, cleanForTelegram, extractRecommendation } from '../ai/llm'
import { sendTelegram } from '../telegram/client'
import { evaluateAlert } from '../telegram/alerts'
import { normalizeTicker } from '../../../lib/format'
import type { AnalysisJobRow } from '../../../lib/types'

// ── DEEP RUN (multi-agent) ──────────────────────────────────────────────────
// One deep run = N persona jobs + 1 consensus job sharing a run_id, drained
// serially by the worker. Deterministic scores are computed once at enqueue
// time and carried in the job payload so every persona judges identical data.

const SEND_TELEGRAM = process.env.SEND_TELEGRAM !== 'false'

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

  const [indicators, news] = await Promise.all([
    computeTickerIndicators(jk),
    getLatestSentiment(jk),
  ])
  const scores = computeAnalystScores(snap, indicators, news?.score ?? null)

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
  const raw = await callLlm(user, { system, temperature: 0.4 })
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
    model: process.env.LLM_MODEL ?? 'unknown',
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
  const rendered = await callLlm(user, { system })
  const raw = enforceRecommendation(rendered, decidedRec)
  const cleanHtml = cleanForTelegram(raw)
  const recommendation = extractRecommendation(raw)

  const prevAnalysis = await getLatestAnalysis(job.ticker)
  const alertEval = evaluateAlert(prevAnalysis, recommendation, new Date())
  // Deep runs are signal-triggered, but a repeat of the same verdict on the
  // same WIB day carries no new information — only alert on a changed
  // recommendation or the first run of a new day.
  const sent = SEND_TELEGRAM && !alertEval.isSame
  if (sent) {
    const header = `<b>${job.ticker.replace('.JK', '')}</b> — ${recommendation} (${votes.length} personas, net ${net})\n\n`
    await sendTelegram(header + cleanHtml)
  }

  await saveAnalysis(
    payload.snapshot_id, job.ticker, `consensus:${process.env.LLM_MODEL ?? 'unknown'}`,
    raw, cleanHtml, recommendation, sent, alertEval.isSame,
  )
  return { net, recommendation, votes: votes.length }
}
