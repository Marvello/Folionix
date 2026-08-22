// app/src/graph/worker.ts — multi-agent deep-run queue worker.
// Drains analysis_jobs serially (Ollama is the bottleneck): persona jobs are
// single structured-JSON LLM calls; the consensus job aggregates them into the
// final recommendation, Telegram alert, and llm_analyses row.
import 'dotenv/config'
import {
  claimAnalysisJob, completeJob, failJob, requeueStaleJobs,
} from '../db/db'
import type { AnalysisJobRow } from '../../../lib/types'

const POLL_MS      = Number(process.env.WORKER_POLL_SEC ?? 10) * 1000
const MAX_ATTEMPTS = Number(process.env.WORKER_MAX_ATTEMPTS ?? 3)
const STALE_MIN    = Number(process.env.DEEP_RUN_STALE_MIN ?? 120)

export type JobHandler = (job: AnalysisJobRow) => Promise<Record<string, unknown> | null>

export interface WorkerDeps {
  handlers: Record<'persona' | 'consensus', JobHandler>
  complete: (id: number, result: Record<string, unknown> | null) => Promise<void>
  fail: (id: number, message: string, attempts: number, maxAttempts: number) => Promise<void>
  maxAttempts: number
}

export async function dispatchJob(job: AnalysisJobRow, deps: WorkerDeps): Promise<void> {
  try {
    const result = await deps.handlers[job.kind](job)
    await deps.complete(job.id!, result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[worker] job ${job.id} (${job.kind} ${job.persona ?? ''} ${job.ticker}) failed: ${msg}`)
    await deps.fail(job.id!, msg, job.attempts ?? 1, deps.maxAttempts)
  }
}

let running = true

process.on('SIGTERM', () => {
  console.log('[worker] SIGTERM received — shutting down after current job')
  running = false
})

async function main(): Promise<void> {
  console.log('[worker] starting analysis-job worker')

  const sweepStale = async (): Promise<void> => {
    try {
      await requeueStaleJobs(STALE_MIN, MAX_ATTEMPTS)
    } catch (err) {
      console.error('[worker] stale-job requeue error:', err)
    }
  }
  await sweepStale()
  // Sweeping only at boot leaves a job stranded 'running' for as long as this
  // process stays up (a crashed run blocks its ticker via hasActiveRun), so
  // re-sweep on idle too.
  let nextSweep = Date.now() + STALE_MIN * 60_000

  const { handlePersonaJob, handleConsensusJob } = await import('../services/deepRun.js')
  const deps: WorkerDeps = {
    handlers: { persona: handlePersonaJob, consensus: handleConsensusJob },
    complete: completeJob,
    fail: failJob,
    maxAttempts: MAX_ATTEMPTS,
  }

  while (running) {
    let claimed = false
    try {
      const job = await claimAnalysisJob(MAX_ATTEMPTS)
      if (job) {
        claimed = true
        console.log(`[worker] claimed job ${job.id}: ${job.kind} ${job.persona ?? ''} ${job.ticker}`)
        await dispatchJob(job, deps)
      }
    } catch (err) {
      console.error('[worker] cycle error:', err)
    }
    // Drain back-to-back while jobs exist; sleep only when the queue is empty.
    if (!claimed && running) {
      if (Date.now() >= nextSweep) {
        await sweepStale()
        nextSweep = Date.now() + STALE_MIN * 60_000
      }
      await new Promise(r => setTimeout(r, POLL_MS))
    }
  }

  console.log('[worker] stopped')
}

if (process.argv[1]?.endsWith('worker.ts') || process.argv[1]?.endsWith('worker.js')) {
  // Smoke-test hook: `npm run worker -- --enqueue BBCA` seeds one deep run
  // before entering the drain loop.
  const enqueueIdx = process.argv.indexOf('--enqueue')
  if (enqueueIdx !== -1 && process.argv[enqueueIdx + 1]) {
    import('../services/deepRun.js')
      .then(({ enqueueDeepRun }) => enqueueDeepRun(process.argv[enqueueIdx + 1]))
      .then(() => main())
      .catch(console.error)
  } else {
    main().catch(console.error)
  }
}
