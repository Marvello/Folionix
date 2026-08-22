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
})
