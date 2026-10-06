import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OrchestratorState } from './state'

const session = vi.fn()
const runAnalysis = vi.fn()
const latest = vi.fn()
vi.mock('./session', () => ({ detectSession: () => session() }))
vi.mock('./analysis', () => ({ runAnalysis: (...a: unknown[]) => runAnalysis(...a), decideDepth: () => 'DEEP' }))
vi.mock('../services/portfolio', () => ({ runPriceRefresh: vi.fn() }))
vi.mock('../db/db', () => ({
  loadPortfolio: async () => ({ 'BBCA.JK': {} }),
  getWatchlist: async () => [],
  getLatestSnapshots: () => latest(),
  getSnapshotBefore: async () => null,
}))

const { runCycle } = await import('./orchestrator')

const base: OrchestratorState = {
  current_session: 'SESSION_1', last_session: 'SESSION_1', last_check: '', last_scheduled: new Date().toISOString(),
  signals: [], signal_cooldowns: {}, pending_batch: [], last_run: null,
}

describe('runCycle', () => {
  beforeEach(() => {
    runAnalysis.mockReset()
    session.mockReturnValue('SESSION_1')
    latest.mockResolvedValue([{ ticker: 'BBCA.JK', day_change_pct: 0.1, volume: 1 }])
  })

  it('does nothing while the market is closed', async () => {
    session.mockReturnValue('CLOSED')
    const next = await runCycle({ ...base, current_session: 'CLOSED', last_session: 'CLOSED' })
    expect(next._route).toBe('skip')
    expect(runAnalysis).not.toHaveBeenCalled()
  })

  it('analyzes a MAJOR mover as a spike and starts its cooldown', async () => {
    latest.mockResolvedValue([{ ticker: 'BBCA.JK', day_change_pct: 9, volume: 1 }])
    const next = await runCycle(base)
    expect(runAnalysis).toHaveBeenCalledWith({ kind: 'tickers', tickers: ['BBCA.JK'] }, 'DEEP', 'spike')
    expect(next.signal_cooldowns['BBCA.JK']).toBeDefined()
  })

  it('runs the scheduled watchlist pass silently when due', async () => {
    await runCycle({ ...base, last_scheduled: null })
    expect(runAnalysis).toHaveBeenCalledWith({ kind: 'watchlist' }, 'DEEP', 'silent')
  })
})
