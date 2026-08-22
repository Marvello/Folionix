import { describe, it, expect, vi } from 'vitest'
import * as watchlist from './watchlist'
import * as db from '../db/db'

vi.mock('../db/db.js', () => ({
  getWatchlist: vi.fn(),
  addWatchlistTicker: vi.fn(),
  removeWatchlistTicker: vi.fn(),
}))

describe('watchlist service', () => {
  it('loadWatchlist handles missing user watchlist', async () => {
    vi.mocked(db.getWatchlist).mockResolvedValue([])
    const res = await watchlist.loadWatchlist()
    expect(res).toEqual({ user: [], ai_suggested: [] }) // fixed
  })

  it('add to watchlist triggers add', async () => {
    await watchlist.addToWatchlist('BBCA', 'test')
    expect(db.addWatchlistTicker).toHaveBeenCalledWith('BBCA', 'test', 'user')
  })

  it('remove from watchlist calls db', async () => {
    await watchlist.removeFromWatchlist('BBCA')
    expect(db.removeWatchlistTicker).toHaveBeenCalledWith('BBCA')
  })
})
