// app/src/services/forex.ts
// Fetches FX rates from open.er-api.com (free, no key, includes IDR).
import { upsertForexRate } from '../db/db.js'
import { withRetry } from '../utils/retry'

const DEFAULT_BASES = ['USD', 'SGD', 'EUR', 'JPY', 'MYR']
const ER_API = 'https://open.er-api.com/v6/latest'

export async function refreshForexRates(bases: string[] = DEFAULT_BASES): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)

  for (const currency of bases) {
    try {
      const idrRate = await withRetry(async () => {
        const res = await fetch(`${ER_API}/${currency}`, {
          signal: AbortSignal.timeout(10_000),
        })
        if (!res.ok) throw new Error(`open.er-api HTTP ${res.status}`)
        const data = (await res.json()) as { result: string; rates: Record<string, number> }
        if (data.result !== 'success') throw new Error(`open.er-api error: ${data.result}`)
        return data.rates['IDR'] ?? null
      }, 3, 500)

      if (!idrRate) {
        console.warn(`[forex] no IDR rate for ${currency}`)
        continue
      }

      await upsertForexRate(currency, 'IDR', idrRate, today)
      console.log(`[forex] ${currency}/IDR = ${idrRate}`)
    } catch (err) {
      console.error(`[forex] ${currency} failed:`, err)
    }
  }
}
