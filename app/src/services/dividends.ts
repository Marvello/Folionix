import { loadPortfolio, upsertDividendSchedule, getDividendScheduleForExDate, getDividendScheduleForPayDate } from '../db/db'
import { fetchDividendSchedule } from '../providers/idx'
import { fetchDividendAmount } from '../providers/market'
import { sendTelegram } from '../telegram/client'
import { displayTicker, fmtIdr, wibDateOffset } from '../../../lib/format'

// ── SYNC (IDX dates + yahoo amount backfill) ──

// Gap between IDX requests — a burst across the whole portfolio trips
// Cloudflare's rate limiting (403s / challenge timeouts).
const IDX_REQUEST_GAP_MS = 3_000

export async function syncDividendSchedules(): Promise<void> {
  const portfolio = await loadPortfolio()
  let first = true
  for (const ticker of Object.keys(portfolio)) {
    if (!first) await new Promise(r => setTimeout(r, IDX_REQUEST_GAP_MS))
    first = false
    try {
      const events = await fetchDividendSchedule(ticker)
      if (events.length === 0) continue

      let yahooAmount: number | null | undefined // undefined = not yet fetched (memoize per ticker)
      for (const ev of events) {
        let amount = ev.amount_per_share
        let estimated = false
        if (amount == null || amount === 0) {
          if (yahooAmount === undefined) {
            try { yahooAmount = await fetchDividendAmount(ticker) } catch { yahooAmount = null }
          }
          if (yahooAmount != null) { amount = yahooAmount; estimated = true }
          else amount = null
        }
        await upsertDividendSchedule({
          ticker,
          cum_date: ev.cum_date,
          ex_date: ev.ex_date,
          recording_date: ev.recording_date,
          pay_date: ev.pay_date,
          amount_per_share: amount,
          amount_estimated: estimated,
          currency: ev.currency,
        })
      }
    } catch (err) {
      console.error(`[dividends] sync ${ticker} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ── REMINDERS (three amount tiers) ──

function amountLine(r: { ticker: string; amount_per_share: number | null; amount_estimated: boolean }, lots: number): string {
  if (r.amount_per_share == null) {
    return `⚠️ <b>${displayTicker(r.ticker)}</b> — amount unavailable, please verify & update`
  }
  const total = fmtIdr(r.amount_per_share * lots * 100)
  return r.amount_estimated
    ? `<b>${displayTicker(r.ticker)}</b> · ~${total} (annual est — verify)`
    : `<b>${displayTicker(r.ticker)}</b> · ${total}`
}

export async function sendDividendReminders(): Promise<void> {
  const portfolio = await loadPortfolio()

  const exRows = await getDividendScheduleForExDate(wibDateOffset(1))
  const exLines = exRows.filter(r => portfolio[r.ticker]).map(r => amountLine(r, portfolio[r.ticker].lots))
  if (exLines.length > 0) {
    await sendTelegram(
      `🔔 <b>Ex-dividend tomorrow — ${wibDateOffset(1)}</b>\n` +
      `<i>Today is the cum date — last day to buy to qualify.</i>\n\n` +
      exLines.join('\n'),
    )
  }

  const payRows = await getDividendScheduleForPayDate(wibDateOffset(0))
  const payLines = payRows.filter(r => portfolio[r.ticker]).map(r => amountLine(r, portfolio[r.ticker].lots))
  if (payLines.length > 0) {
    await sendTelegram(
      `💰 <b>Dividend paid today — ${wibDateOffset(0)}</b>\n` +
      `<i>Record it under the stock's dividends.</i>\n\n` +
      payLines.join('\n'),
    )
  }
}
