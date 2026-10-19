// Runtime-editable settings: the whitelist shared by app/ (which applies them)
// and web/ (which edits them). A row in public.app_settings overrides the
// matching .env variable; deleting the row falls back to .env, then to the
// built-in default. Secrets and infrastructure (DB, auth, tokens, API keys,
// URLs, SMTP) are deliberately NOT here — they stay in .env only.

/** Investor personas in style-balanced order (value, contrarian, growth, macro, …).
 *  The first six are the default set. app/src/ai/personas.ts defines each one. */
export const PERSONA_KEYS = [
  'buffett', 'burry', 'lynch', 'druckenmiller', 'graham', 'wood',
  'damodaran', 'munger', 'fisher', 'ackman', 'pabrai', 'jhunjhunwala',
] as const

export type SettingType = 'number' | 'bool' | 'hours' | 'personas' | 'text'

export interface SettingDef {
  key: string
  group: 'Alerts & signals' | 'Recommendation & AI' | 'Schedules'
  label: string
  type: SettingType
  /** Built-in default, as the user would type it. */
  default: string
  unit?: string
  min?: number
  max?: number
  int?: boolean
  /** Plain-language explanation: what it does, what raising/lowering it changes. */
  help: string
  /** Optional concrete example. */
  example?: string
}

export const SETTINGS: SettingDef[] = [
  // ── Alerts & signals ──
  {
    key: 'SEND_TELEGRAM', group: 'Alerts & signals', label: 'Send Telegram alerts', type: 'bool', default: 'true',
    help: 'Switch for automatic Telegram alerts: stock recommendation alerts, deep-run results, gold price alerts and new-bond alerts. When off, everything is still analysed and saved to the dashboard, it just is not pushed to Telegram. Not affected (always sent): replies to bot commands you type, dividend and bond-coupon reminders, and the weekly review message.',
  },
  {
    key: 'SIGNAL_PRICE_MINOR', group: 'Alerts & signals', label: 'Price move: minor signal', type: 'number', default: '3', unit: '%', min: 0.1, max: 50,
    help: "A stock whose price today has moved at least this much (up or down, versus yesterday's close) gets a MINOR signal. A minor signal on its own is only recorded — it does not trigger an analysis. If both the price and the volume rules are met at the same time, the signal is upgraded to MAJOR. Must be lower than the major threshold.",
    example: '3 → a move from 1,000 to 1,030 or 970 counts.',
  },
  {
    key: 'SIGNAL_PRICE_MAJOR', group: 'Alerts & signals', label: 'Price move: major signal', type: 'number', default: '5', unit: '%', min: 0.1, max: 50,
    help: "A stock whose price today has moved at least this much (up or down, versus yesterday's close) gets a MAJOR signal, which immediately triggers a fresh AI analysis of that stock (and a Telegram alert if the recommendation changes). Lower = more frequent analyses and alerts; higher = only big moves.",
    example: '5 → a move from 1,000 to 1,050 or 950 triggers an analysis.',
  },
  {
    key: 'SIGNAL_VOLUME_MINOR', group: 'Alerts & signals', label: 'Volume spike: minor signal', type: 'number', default: '1.5', unit: '× volume', min: 1, max: 100,
    help: "Volume ratio = today's traded volume divided by the volume of the same stock about one week ago. At or above this ratio the stock gets a MINOR signal (recorded only, no analysis). Combined with a minor price move it becomes MAJOR. Must be lower than the major threshold.",
    example: '1.5 → 15M shares today vs 10M a week ago counts.',
  },
  {
    key: 'SIGNAL_VOLUME_MAJOR', group: 'Alerts & signals', label: 'Volume spike: major signal', type: 'number', default: '3', unit: '× volume', min: 1, max: 100,
    help: "At or above this volume ratio (today's volume ÷ volume about one week ago) the stock gets a MAJOR signal, which immediately triggers a fresh AI analysis.",
    example: '3 → 30M shares today vs 10M a week ago triggers an analysis.',
  },
  {
    key: 'SIGNAL_COOLDOWN_MIN', group: 'Alerts & signals', label: 'Signal cooldown', type: 'number', default: '60', unit: 'minutes', min: 1, max: 1440, int: true,
    help: 'After a stock has been analysed because of a MAJOR signal, further signals for that same stock are ignored for this many minutes. Prevents a stock that stays up 7% all day from being re-analysed (and re-alerted) every few minutes.',
  },
  {
    key: 'GOLD_ALERT_PCT', group: 'Alerts & signals', label: 'Gold price alert', type: 'number', default: '3', unit: '%', min: 0.1, max: 50,
    help: "Sends a Telegram alert when a gold venue's mid price (average of buy and sell price) has moved at least this much, up or down, since the previous gold price check. Checks run every \"Gold refresh interval\" hours.",
    example: '3 → 1,500,000/g to 1,545,000/g alerts.',
  },
  {
    key: 'BOND_ALERT_MIN_COUPON_PCT', group: 'Alerts & signals', label: 'New bond alert: minimum coupon', type: 'number', default: '9', unit: '% p.a.', min: 0, max: 30,
    help: 'When a new corporate bond, sukuk or NCD is registered on KSEI, you get a Telegram alert only if its highest tranche coupon is above this annual rate. Bonds whose coupon cannot be read from the KSEI document are always alerted (flagged "coupon unknown") so nothing is missed.',
    example: '9 → a bond with tranches at 8.5% and 9.25% alerts; one at 8.75% max does not.',
  },

  // ── Recommendation & AI ──
  {
    key: 'REC_STABILITY_PCT', group: 'Recommendation & AI', label: 'Re-analysis price threshold', type: 'number', default: '2', unit: '%', min: 0, max: 50,
    help: 'Saves AI calls: whenever a stock is due for analysis (scheduled or signal-triggered), it is skipped and its previous recommendation kept while its price has moved less than this much since the price at which that recommendation was made. Once it moves more, or the recommendation gets older than "Recommendation max age", it is re-analysed. 0 = always re-analyse.',
    example: 'Recommended at 1,000 with 2 → skipped until price reaches 1,020 or 980.',
  },
  {
    key: 'REC_MAX_AGE_HOURS', group: 'Recommendation & AI', label: 'Recommendation max age', type: 'number', default: '72', unit: 'hours', min: 1, max: 720,
    help: 'A recommendation older than this is always refreshed on the next scheduled analysis, even if the price has not moved. Keeps calls on quiet stocks from going stale.',
  },
  {
    key: 'DEEP_RUNS_ENABLED', group: 'Recommendation & AI', label: 'Multi-agent deep runs', type: 'bool', default: 'false',
    help: 'When on, a MAJOR signal sends the stock to the multi-agent "deep run": each enabled investor persona (see "Investor personas") gives its own verdict, then a consensus step combines them into one recommendation. Slower and uses many more AI calls than the normal single analysis. When off, MAJOR signals use the normal single analysis. Scheduled analyses always use the normal single analysis.',
  },
  {
    key: 'PERSONAS', group: 'Recommendation & AI', label: 'Investor personas', type: 'personas', default: 'buffett,burry,lynch,druckenmiller,graham,wood',
    help: `Which investor personas vote in a deep run (only used when "Multi-agent deep runs" is on). Each persona = one extra AI call per deep run. Enter one of: "all" (all 12); a number N (the first N of a style-balanced order, so any N mixes value, contrarian, growth and macro styles); or a comma-separated list of names. Available: ${PERSONA_KEYS.join(', ')}.`,
    example: '"6", or "buffett,lynch,burry".',
  },
  {
    key: 'CONSENSUS_MIN_PERSONAS', group: 'Recommendation & AI', label: 'Minimum persona votes', type: 'number', default: 'half of the enabled personas (rounded up)', min: 1, max: PERSONA_KEYS.length, int: true,
    help: 'A deep run only produces a consensus recommendation if at least this many personas returned a valid verdict (some can fail or time out). Below this, the consensus step fails and is retried. Must not exceed the number of enabled personas, or every deep run will fail.',
    example: '4 with 6 personas → up to 2 may fail.',
  },
  {
    key: 'LLM_MODEL', group: 'Recommendation & AI', label: 'AI model (primary)', type: 'text', default: 'qwen2.5:7b',
    help: 'Name of the AI model used for every analysis, exactly as your AI server knows it (for Ollama, as shown by "ollama list"; for an OpenAI-compatible gateway, its model id). The server address and API key stay in .env. A wrong name makes every analysis fall back to the fallback model or fail — test with a quick /analyze in Telegram after changing.',
    example: 'qwen2.5:14b',
  },
  {
    key: 'LLM_FALLBACK_MODEL', group: 'Recommendation & AI', label: 'AI model (fallback)', type: 'text', default: 'same as primary model',
    help: 'Model used when the primary model fails. Only takes effect if a fallback AI server is configured in .env (LLM_FALLBACK_BACKEND); otherwise this setting does nothing.',
  },

  // ── Schedules ──
  {
    key: 'GRAPH_ANALYSIS_INTERVAL', group: 'Schedules', label: 'Scheduled analysis interval', type: 'number', default: '30', unit: 'minutes', min: 5, max: 1440, int: true,
    help: 'During market hours, all portfolio and watchlist stocks are analysed at least this often (plus once at every trading-session change, e.g. session 1 → lunch). Stocks that barely moved are skipped per "Re-analysis price threshold". Lower = fresher recommendations but more AI calls. Signal-triggered analyses happen independently of this.',
  },
  {
    key: 'CACHE_MINUTES', group: 'Schedules', label: 'Stock price cache', type: 'number', default: '15', unit: 'minutes', min: 1, max: 1440, int: true,
    help: 'When an analysis needs the price of a stock, a price fetched less than this many minutes ago is reused instead of asking Yahoo Finance again. Lower = the AI sees fresher prices but more requests (risk of rate limiting); higher = fewer requests but the AI may analyse a slightly old price. The regular price refresh and the dashboard "Refresh" button always fetch fresh prices regardless.',
  },
  {
    key: 'GOLD_REFRESH_HOURS', group: 'Schedules', label: 'Gold refresh interval', type: 'number', default: '3', unit: 'hours', min: 0.5, max: 24,
    help: 'How often gold buy/sell prices are fetched from the venues, around the clock. Each fetch is also when the gold price alert is checked.',
  },
  {
    key: 'FUNDAMENTALS_HOUR_WIB', group: 'Schedules', label: 'Daily fundamentals update', type: 'number', default: '18', unit: 'hour (WIB, 0–23)', min: 0, max: 23, int: true,
    help: 'Hour of the day (Jakarta time, 24-hour clock) when key stats, financial statements and stock splits are refreshed for all stocks — once per day. Keep it after market close and away from 17 (the daily fund NAV update).',
    example: '18 → runs at 18:00 WIB.',
  },
  {
    key: 'BOND_REG_CHECK_HOURS_WIB', group: 'Schedules', label: 'New bond check times', type: 'hours', default: '9,15', unit: 'hours (WIB)',
    help: 'Hours of the day (Jakarta time, 24-hour clock, comma-separated) when KSEI is checked for newly registered corporate bonds. Each listed hour runs once per day.',
    example: '"9,15" → 09:00 and 15:00 WIB.',
  },
]

export const SETTING_KEYS: ReadonlySet<string> = new Set(SETTINGS.map((s) => s.key))

export function getSettingDef(key: string): SettingDef | undefined {
  return SETTINGS.find((s) => s.key === key)
}

/** Normalise and validate a raw value. Returns the canonical string, or throws
 *  an Error whose message is safe to show the user. */
export function validateSetting(key: string, raw: unknown): string {
  const def = getSettingDef(key)
  if (!def) throw new Error(`Unknown setting ${key}`)
  if (typeof raw !== 'string') throw new Error(`${def.label}: value required`)
  const v = raw.trim()
  if (!v) throw new Error(`${def.label}: value required`)

  switch (def.type) {
    case 'bool': {
      const b = v.toLowerCase()
      if (b !== 'true' && b !== 'false') throw new Error(`${def.label}: must be on or off`)
      return b
    }
    case 'number': {
      const n = Number(v)
      if (!Number.isFinite(n)) throw new Error(`${def.label}: must be a number`)
      if (def.int && !Number.isInteger(n)) throw new Error(`${def.label}: must be a whole number`)
      if (def.min != null && n < def.min) throw new Error(`${def.label}: must be at least ${def.min}`)
      if (def.max != null && n > def.max) throw new Error(`${def.label}: must be at most ${def.max}`)
      return String(n)
    }
    case 'hours': {
      const parts = v.split(',').map((h) => h.trim())
      if (parts.some((h) => !/^\d{1,2}$/.test(h) || Number(h) > 23)) {
        throw new Error(`${def.label}: comma-separated hours 0–23, e.g. 9,15`)
      }
      return [...new Set(parts.map(Number))].sort((a, b) => a - b).join(',')
    }
    case 'personas': {
      const p = v.toLowerCase()
      if (p === 'all') return p
      if (/^\d+$/.test(p)) {
        const n = Number(p)
        if (n < 1 || n > PERSONA_KEYS.length) throw new Error(`${def.label}: number must be 1–${PERSONA_KEYS.length}`)
        return String(n)
      }
      const names = p.split(',').map((s) => s.trim()).filter(Boolean)
      const unknown = names.filter((n) => !(PERSONA_KEYS as readonly string[]).includes(n))
      if (unknown.length) throw new Error(`${def.label}: unknown persona ${unknown.join(', ')}`)
      return [...new Set(names)].join(',')
    }
    case 'text': {
      if (v.length > 200 || /\s/.test(v)) throw new Error(`${def.label}: a single model name without spaces`)
      return v
    }
  }
}

/** Cross-field checks the single-value validator cannot see. `values` = the
 *  effective values after the change (unset keys omitted). */
export function validateCombination(values: Record<string, string | undefined>): void {
  const pair = (minor: string, major: string, label: string) => {
    const a = Number(values[minor] ?? getSettingDef(minor)!.default)
    const b = Number(values[major] ?? getSettingDef(major)!.default)
    if (a >= b) throw new Error(`${label}: the minor threshold (${a}) must be lower than the major one (${b})`)
  }
  pair('SIGNAL_PRICE_MINOR', 'SIGNAL_PRICE_MAJOR', 'Price move')
  pair('SIGNAL_VOLUME_MINOR', 'SIGNAL_VOLUME_MAJOR', 'Volume spike')

  const minVotes = values.CONSENSUS_MIN_PERSONAS
  if (minVotes != null) {
    const p = values.PERSONAS ?? getSettingDef('PERSONAS')!.default
    const enabled = p === 'all' ? PERSONA_KEYS.length : /^\d+$/.test(p) ? Number(p) : p.split(',').length
    if (Number(minVotes) > enabled) {
      throw new Error(`Minimum persona votes (${minVotes}) is more than the ${enabled} enabled personas — every deep run would fail`)
    }
  }
}
