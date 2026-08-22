import 'dotenv/config'
import { Bot, Context } from 'grammy'
import {
  loadPortfolio, upsertPosition, deactivatePosition, getAllPositions,
} from '../db/db'
import { loadWatchlist, addToWatchlist, removeFromWatchlist } from '../services/watchlist'
import { listGoldHoldings, addGoldPurchase, deactivateGoldPurchase } from '../services/gold'
import { listFundHoldings } from '../services/funds'
import { listBondHoldings } from '../services/bonds'
import { refreshForexRates } from '../services/forex'
import { runPortfolioPipeline, runPriceRefresh } from '../services/portfolio'
import { runWeekReview } from '../services/weekReview'
import { fetchGoldPrices } from '../providers/cermati'
import { displayTicker, fmtIdr, fmtCap, normalizeTicker } from '../../../lib/format'

const TICKER_RE = /^[A-Z0-9]{1,10}$/

export function validateTicker(raw: string): void {
  if (!TICKER_RE.test(raw.trim().toUpperCase())) {
    throw new Error(`Invalid ticker: ${raw}`)
  }
}

export function validatePrice(n: number): void {
  if (n <= 0) throw new Error('AVG_PRICE must be > 0')
  if (n > 1_000_000_000) throw new Error('AVG_PRICE too large (max 1,000,000,000)')
}

export function validateLots(n: number): void {
  if (n < 1) throw new Error('LOTS must be >= 1')
  if (n > 1_000_000) throw new Error('LOTS too large (max 1,000,000)')
}

export function validateGrams(n: number): void {
  if (n <= 0) throw new Error('GRAMS must be > 0')
  if (n > 100_000) throw new Error('GRAMS too large (max 100,000)')
}

export function startBot(): void {
  const token = process.env.TELEGRAM_TOKEN
  if (!token) throw new Error('TELEGRAM_TOKEN not set')

  const ALLOWED_CHAT_ID = process.env.TELEGRAM_CHAT_ID
  if (!ALLOWED_CHAT_ID) {
    // Fail closed: without a whitelist, any chat could mutate the portfolio.
    throw new Error('TELEGRAM_CHAT_ID not set — refusing to start unrestricted bot')
  }
  const bot = new Bot(token)

  function isAllowed(ctx: Context): boolean {
    return String(ctx.chat?.id) === ALLOWED_CHAT_ID
  }

  function guard(handler: (ctx: Context, args?: string[]) => Promise<any>) {
    return async (ctx: Context) => {
      if (!isAllowed(ctx)) {
        await ctx.reply('Unauthorized.')
        return
      }
      const text = ctx.message?.text ?? ''
      const args = text.split(/\s+/).slice(1)
      try {
        await handler(ctx, args)
      } catch (err) {
        console.error('[bot] error:', err)
        await ctx.reply('An error occurred. Check logs.')
      }
    }
  }

// /status — show all active positions
bot.command('status', guard(async (ctx) => {
  const positions = await getAllPositions()
  if (positions.length === 0) {
    await ctx.reply('No active positions.')
    return
  }
  const lines = positions.map(p =>
    `<b>${displayTicker(p.ticker)}</b> — ${p.lots} lots @ ${fmtIdr(p.avg_price)}`
  )
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
}))

// /add TICKER AVG_PRICE LOTS [NOTES]
bot.command('add', guard(async (ctx, args) => {
  if (!args || args.length < 3) {
    await ctx.reply('Usage: /add TICKER AVG_PRICE LOTS [NOTES]')
    return
  }
  const avgPrice = Number(args[1])
  const lots = Number(args[2])
  const notes = args.slice(3).join(' ') || null
  if (isNaN(avgPrice) || isNaN(lots)) {
    await ctx.reply('AVG_PRICE and LOTS must be numbers.')
    return
  }
  try {
    validateTicker(args[0])
    validatePrice(avgPrice)
    validateLots(lots)
  } catch (err) {
    await ctx.reply(String(err instanceof Error ? err.message : err))
    return
  }
  const ticker = normalizeTicker(args[0])
  await upsertPosition(ticker, avgPrice, lots, notes)
  await runPriceRefresh([ticker])
  await ctx.reply(`Added ${ticker}: ${lots} lots @ ${fmtIdr(avgPrice)}`)
}))

// /update TICKER AVG_PRICE LOTS [NOTES]
bot.command('update', guard(async (ctx, args) => {
  if (!args || args.length < 3) {
    await ctx.reply('Usage: /update TICKER AVG_PRICE LOTS [NOTES]')
    return
  }
  const avgPrice = Number(args[1])
  const lots = Number(args[2])
  const notes = args.slice(3).join(' ') || null
  if (isNaN(avgPrice) || isNaN(lots)) {
    await ctx.reply('AVG_PRICE and LOTS must be numbers.')
    return
  }
  try {
    validateTicker(args[0])
    validatePrice(avgPrice)
    validateLots(lots)
  } catch (err) {
    await ctx.reply(String(err instanceof Error ? err.message : err))
    return
  }
  const ticker = normalizeTicker(args[0])
  await upsertPosition(ticker, avgPrice, lots, notes)
  await ctx.reply(`Updated ${ticker}: ${lots} lots @ ${fmtIdr(avgPrice)}`)
}))

// /remove TICKER
bot.command('remove', guard(async (ctx, args) => {
  if (!args || !args[0]) {
    await ctx.reply('Usage: /remove TICKER')
    return
  }
  try {
    validateTicker(args[0])
  } catch (err) {
    await ctx.reply(String(err instanceof Error ? err.message : err))
    return
  }
  const ticker = normalizeTicker(args[0])
  await deactivatePosition(ticker)
  await ctx.reply(`Removed ${ticker} from portfolio.`)
}))

// /analyze [TICKER...]
bot.command('analyze', guard(async (ctx, args) => {
  if (args && args.length > 0) {
    try {
      args.forEach(validateTicker)
    } catch (err) {
      await ctx.reply(String(err instanceof Error ? err.message : err))
      return
    }
  }
  await ctx.reply('Running analysis...')
  const tickers = args && args.length > 0 ? args.map(normalizeTicker) : undefined
  await runPortfolioPipeline(tickers)
  await ctx.reply('Analysis complete.')
}))

// /wadd TICKER [NOTES]
bot.command('wadd', guard(async (ctx, args) => {
  if (!args || !args[0]) {
    await ctx.reply('Usage: /wadd TICKER [NOTES]')
    return
  }
  try {
    validateTicker(args[0])
  } catch (err) {
    await ctx.reply(String(err instanceof Error ? err.message : err))
    return
  }
  const ticker = normalizeTicker(args[0])
  const notes = args.slice(1).join(' ') || null
  await addToWatchlist(ticker, notes)
  await runPriceRefresh([ticker])
  await ctx.reply(`Added ${ticker} to watchlist.`)
}))

// /wremove TICKER
bot.command('wremove', guard(async (ctx, args) => {
  if (!args || !args[0]) {
    await ctx.reply('Usage: /wremove TICKER')
    return
  }
  try {
    validateTicker(args[0])
  } catch (err) {
    await ctx.reply(String(err instanceof Error ? err.message : err))
    return
  }
  await removeFromWatchlist(normalizeTicker(args[0]))
  await ctx.reply(`Removed from watchlist.`)
}))

// /wlist
bot.command('wlist', guard(async (ctx) => {
  const wl = await loadWatchlist()
  const all = [...wl.user, ...wl.ai_suggested]
  if (all.length === 0) {
    await ctx.reply('Watchlist is empty.')
    return
  }
  const lines = all.map(w => `${w.kind === 'ai_suggested' ? '🤖' : '👤'} <b>${displayTicker(w.ticker)}</b>${w.notes ? ' — ' + w.notes : ''}`)
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
}))

// /gadd VENUE GRAMS PRICE [NOTES]
bot.command('gadd', guard(async (ctx, args) => {
  if (!args || args.length < 3) {
    await ctx.reply('Usage: /gadd VENUE GRAMS PRICE [NOTES]')
    return
  }
  const venue = args[0].toLowerCase()
  const grams = Number(args[1])
  const price = Number(args[2])
  const notes = args.slice(3).join(' ') || null
  if (isNaN(grams) || isNaN(price)) {
    await ctx.reply('GRAMS and PRICE must be numbers.')
    return
  }
  try {
    validateGrams(grams)
    validatePrice(price)
  } catch (err) {
    await ctx.reply(String(err instanceof Error ? err.message : err))
    return
  }
  const id = await addGoldPurchase(venue, grams, price, notes)
  await ctx.reply(`Gold purchase recorded (id: ${id}): ${grams}g @ ${fmtIdr(price)}/g at ${venue}`)
}))

// /glist
bot.command('glist', guard(async (ctx) => {
  const { holdings } = await listGoldHoldings()
  if (holdings.length === 0) {
    await ctx.reply('No gold holdings.')
    return
  }
  const lines = holdings.map(h => {
    const status = h.currentValue != null
      ? `${fmtIdr(h.currentPrice ?? 0)}/g | ${fmtIdr(h.currentValue)} (${(h.unrealizedPnlPct ?? 0).toFixed(1)}%)`
      : 'price N/A'
    const realized = h.realizedPnl ? ` | realized ${fmtIdr(h.realizedPnl)}` : ''
    return `<b>${h.venue}</b> ${h.grams}g — ${status}${realized}`
  })
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
}))

// /gremove ID
bot.command('gremove', guard(async (ctx, args) => {
  const id = Number(args?.[0])
  if (isNaN(id)) {
    await ctx.reply('Usage: /gremove ID')
    return
  }
  await deactivateGoldPurchase(id)
  await ctx.reply(`Removed gold purchase #${id}`)
}))

// /gprice
bot.command('gprice', guard(async (ctx) => {
  const prices = await fetchGoldPrices()
  if (Object.keys(prices).length === 0) {
    await ctx.reply('No gold prices available.')
    return
  }
  const lines = Object.entries(prices).map(([v, p]) => `<b>${v}</b>: Buy ${fmtIdr(p.buy)}/g · Sell ${fmtIdr(p.sell)}/g`)
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
}))

// /flist
bot.command('flist', guard(async (ctx) => {
  const holdings = await listFundHoldings()
  if (holdings.length === 0) {
    await ctx.reply('No fund holdings.')
    return
  }
  const lines = holdings.map(h => {
    const val = h.currentValue != null ? `${fmtIdr(h.currentValue)} (${(h.unrealizedPnlPct ?? 0).toFixed(1)}%)` : 'NAV N/A'
    const realized = h.realizedPnl ? ` | realized ${fmtIdr(h.realizedPnl)}` : ''
    return `<b>${h.fundCode}</b> ${h.units} units — ${val}${realized}`
  })
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
}))

// /fxrefresh
bot.command('fxrefresh', guard(async (ctx) => {
  await ctx.reply('Refreshing forex rates…')
  try {
    await refreshForexRates()
    await ctx.reply('✓ Forex rates updated.')
  } catch (err) {
    await ctx.reply(`Failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}))

// /blist
bot.command('blist', guard(async (ctx) => {
  const summaries = await listBondHoldings()
  if (summaries.length === 0) {
    await ctx.reply('No bond holdings.')
    return
  }
  const lines = summaries.map(s =>
    `<b>${s.holding.series_code}</b> ${fmtIdr(s.holding.principal)} | ${s.holding.coupon_rate}% p.a. | ${s.daysToMaturity}d left`
  )
  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
}))

// /weekreview — generate the weekly portfolio + AI review on demand
bot.command('weekreview', guard(async (ctx) => {
  await ctx.reply('Generating weekly review — this can take a few minutes…')
  const result = await runWeekReview()
  const wow = result.stats.wow_pct != null
    ? `${result.stats.wow_pct >= 0 ? '+' : ''}${result.stats.wow_pct.toFixed(2)}%`
    : 'N/A'
  await ctx.reply(
    `✓ Week review #${result.id} saved (${result.weekStart} → ${result.weekEnd}).\n` +
    `Net worth ${fmtIdr(result.stats.net_worth)} (${wow} WoW). See dashboard → /reviews.`,
    { parse_mode: 'HTML' },
  )
}))

  console.log('[bot] starting long-polling...')
  bot.start()
}

if (process.argv[1]?.endsWith('bot.ts') || process.argv[1]?.endsWith('bot.js')) {
  startBot()
}
