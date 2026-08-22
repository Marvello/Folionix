import 'dotenv/config'
import { withRetry } from '../utils/retry'

export interface FinnhubQuote {
  c: number   // current price (USD — caveat: Finnhub quotes are USD)
  d: number   // day change
  dp: number  // day change percent
  h: number   // day high
  l: number   // day low
}

export async function fetchFinnhubQuote(
  ticker: string,
): Promise<FinnhubQuote | null> {
  const apiKey = process.env.FINNHUB_API_KEY
  if (!apiKey) return null

  const base = process.env.FINNHUB_BASE_URL ?? 'https://finnhub.io/api/v1'
  // Finnhub's international symbols carry the exchange suffix ('BBCA.JK'),
  // same as yahoo. Stripping it turns an IDX ticker into a US one — 'HEAL.JK'
  // → 'HEAL' quoted a US-listed stock in USD and poisoned snapshot history.
  const symbol = ticker

  try {
    return await withRetry(async () => {
      const url = `${base}/quote?symbol=${encodeURIComponent(symbol)}`
      const res = await fetch(url, {
        headers: { 'X-Finnhub-Token': apiKey },
        signal: AbortSignal.timeout(10_000),
      })
      // 4xx errors are not transient — don't retry them
      if (res.status >= 400 && res.status < 500) return null
      if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`)
      const data = (await res.json()) as FinnhubQuote
      if (!data.c) return null
      return data
    }, 3, 500)
  } catch {
    return null
  }
}
