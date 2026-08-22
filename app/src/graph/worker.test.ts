import { describe, it, expect, vi } from 'vitest'
import { dispatchJob, type WorkerDeps } from './worker'
import type { AnalysisJobRow } from '../../../lib/types'

const job = (over: Partial<AnalysisJobRow> = {}): AnalysisJobRow => ({
  id: 7, ticker: 'BBCA.JK', kind: 'persona', persona: 'buffett',
  run_id: 'run-1', attempts: 1, ...over,
})

const deps = (over: Partial<WorkerDeps> = {}): WorkerDeps => ({
  handlers: {
    persona: vi.fn().mockResolvedValue({ signal: 'bullish' }),
    consensus: vi.fn().mockResolvedValue({ recommendation: 'HOLD' }),
  },
  complete: vi.fn().mockResolvedValue(undefined),
  fail: vi.fn().mockResolvedValue(undefined),
  maxAttempts: 3,
  ...over,
})

describe('dispatchJob', () => {
  it('routes to the kind handler and completes with its result', async () => {
    const d = deps()
    await dispatchJob(job(), d)
    expect(d.handlers.persona).toHaveBeenCalledOnce()
    expect(d.complete).toHaveBeenCalledWith(7, { signal: 'bullish' })
    expect(d.fail).not.toHaveBeenCalled()
  })

  it('routes consensus jobs to the consensus handler', async () => {
    const d = deps()
    await dispatchJob(job({ kind: 'consensus', persona: null }), d)
    expect(d.handlers.consensus).toHaveBeenCalledOnce()
  })

  it('fails the job with attempts context when the handler throws', async () => {
    const d = deps()
    ;(d.handlers.persona as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('LLM down'))
    await dispatchJob(job({ attempts: 2 }), d)
    expect(d.fail).toHaveBeenCalledWith(7, 'LLM down', 2, 3)
    expect(d.complete).not.toHaveBeenCalled()
  })
})
