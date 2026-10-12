import { describe, it, expect, vi } from 'vitest'
import * as gold from './gold'
import * as db from '../db/db'

vi.mock('../db/db.js')

describe('gold service', () => {
  it('listGoldHoldings returns empty when no purchases', async () => {
    vi.mocked(db.getGoldPurchases).mockResolvedValue([])
    const res = await gold.listGoldHoldings()
    expect(res.holdings).toEqual([])
  })

  describe('evaluateGoldAlert', () => {
    it('fires up when mid rises past threshold', () => {
      expect(gold.evaluateGoldAlert(1_000_000, 1_031_000, 3))
        .toEqual({ alert: true, pct: expect.closeTo(3.1, 5), dir: 'up' })
    })
    it('fires down when mid falls past threshold', () => {
      const ev = gold.evaluateGoldAlert(1_000_000, 960_000, 3)
      expect(ev).toMatchObject({ alert: true, dir: 'down' })
      expect(ev!.pct).toBeCloseTo(-4, 5)
    })
    it('does not fire within threshold', () => {
      expect(gold.evaluateGoldAlert(1_000_000, 1_020_000, 3)?.alert).toBe(false)
    })
    it('returns null with no comparable previous mid', () => {
      expect(gold.evaluateGoldAlert(null, 1_000_000, 3)).toBeNull()
      expect(gold.evaluateGoldAlert(0, 1_000_000, 3)).toBeNull()
    })
  })
})
