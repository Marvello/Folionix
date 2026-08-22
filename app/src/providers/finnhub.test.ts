import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('fetchFinnhubQuote', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.FINNHUB_API_KEY
    delete process.env.FINNHUB_BASE_URL
    vi.clearAllMocks()
  })

  it('returns null when FINNHUB_API_KEY not set', async () => {
    delete process.env.FINNHUB_API_KEY
    global.fetch = vi.fn()

    const { fetchFinnhubQuote } = await import('./finnhub.js')
    const result = await fetchFinnhubQuote('BBCA')
    expect(result).toBeNull()
  })

  it('fetches quote when key is set', async () => {
    process.env.FINNHUB_API_KEY = 'test-key'
    process.env.FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ c: 5.23, d: 0.12, dp: 2.35, h: 5.30, l: 5.10 }),
    }) as any

    const { fetchFinnhubQuote } = await import('./finnhub.js')
    const result = await fetchFinnhubQuote('BBCA')
    expect(result?.c).toBe(5.23)
  })

  it('keeps the .JK exchange suffix in the Finnhub symbol', async () => {
    process.env.FINNHUB_API_KEY = 'test-key'
    process.env.FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ c: 5.23, d: 0.12, dp: 2.35, h: 5.30, l: 5.10 }),
    }) as any

    const { fetchFinnhubQuote } = await import('./finnhub.js')
    await fetchFinnhubQuote('HEAL.JK')

    const callUrl = (global.fetch as any).mock.calls[0][0]
    // Bare 'HEAL' is a US-listed symbol on Finnhub — the suffix must survive
    expect(callUrl).toContain(`symbol=${encodeURIComponent('HEAL.JK')}`)
  })

  it('returns null on HTTP error', async () => {
    process.env.FINNHUB_API_KEY = 'test-key'
    process.env.FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }) as any

    const { fetchFinnhubQuote } = await import('./finnhub.js')
    const result = await fetchFinnhubQuote('BBCA')
    expect(result).toBeNull()
  })

  it('returns null when price is zero', async () => {
    process.env.FINNHUB_API_KEY = 'test-key'
    process.env.FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ c: 0, d: 0, dp: 0, h: 0, l: 0 }),
    }) as any

    const { fetchFinnhubQuote } = await import('./finnhub.js')
    const result = await fetchFinnhubQuote('BBCA')
    expect(result).toBeNull()
  })

  it('returns null on network error', async () => {
    process.env.FINNHUB_API_KEY = 'test-key'
    process.env.FINNHUB_BASE_URL = 'https://finnhub.io/api/v1'

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any

    const { fetchFinnhubQuote } = await import('./finnhub.js')
    const result = await fetchFinnhubQuote('BBCA')
    expect(result).toBeNull()
  })

  it('sends API key in Authorization header, not query string', async () => {
    const calls: [string, RequestInit | undefined][] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      return new Response(JSON.stringify({ c: 7200, d: 50, dp: 0.7, h: 7300, l: 7100 }), { status: 200 })
    }))
    process.env.FINNHUB_API_KEY = 'test-secret'
    const { fetchFinnhubQuote } = await import('./finnhub.js')
    await fetchFinnhubQuote('BBCA')
    const [url, init] = calls[0]
    expect(url).not.toContain('token=')
    const authHeader = (init?.headers as Record<string, string>)?.['X-Finnhub-Token']
    expect(authHeader).toBe('test-secret')
    vi.unstubAllGlobals()
  })
})
