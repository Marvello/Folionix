// app/src/services/watchlist.ts
import {
  getWatchlist, addWatchlistTicker, removeWatchlistTicker,
} from '../db/db'
import type { WatchlistRow } from '../../../lib/types'

export interface WatchlistSplit {
  user: WatchlistRow[]
  ai_suggested: WatchlistRow[]
}

export async function loadWatchlist(): Promise<WatchlistSplit> {
  const all = await getWatchlist()
  return {
    user: all.filter(w => w.kind === 'user'),
    ai_suggested: all.filter(w => w.kind === 'ai_suggested'),
  }
}

export function allTickers(wl: WatchlistSplit): string[] {
  return [...wl.user, ...wl.ai_suggested].map(w => w.ticker)
}

export async function addToWatchlist(ticker: string, notes: string | null): Promise<void> {
  await addWatchlistTicker(ticker, notes, 'user')
}

export async function removeFromWatchlist(ticker: string): Promise<void> {
  await removeWatchlistTicker(ticker)
}
