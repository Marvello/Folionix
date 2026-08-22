import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Gold GraphQL response (matches actual Cermati API shape) ─────────────────
const mockGoldResponse = {
  data: {
    getGoldPrice: {
      __typename: 'GetGoldPrice_Response',
      current: {
        buyPrice: 1_100_000,
        sellPrice: 1_050_000,
        midPrice: 1_075_000,
        priceAt: '2026-06-29T10:00:00Z',
        __typename: 'GetGoldPrice_CurrentPrice',
      },
    },
  },
}

// ── Fund REST response (matches actual Cermati fund list API) ────────────────
// Page 0: full page (100 items would stop, but here we have 1 < 100 so loop stops)
const mockFundPage0 = {
  data: [
    {
      code: 'MAMI',
      name: 'Manulife Equity Fund',
      currentNav: 12_500,
      lastUpdatedNav: '2026-06-29T00:00:00Z',
      type: 'Saham',
      category: 'Equity',
    },
  ],
}

describe('fetchGoldPrices', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.CERMATI_GRAPHQL_URL
    delete process.env.CERMATI_COOKIE
    vi.clearAllMocks()
  })

  it('returns venue map with sell price on success', async () => {
    process.env.CERMATI_GRAPHQL_URL = 'https://edge.cermati.com/graphql'

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockGoldResponse,
    }) as any

    const { fetchGoldPrices } = await import('./cermati.js')
    const prices = await fetchGoldPrices()

    expect(prices['cermati']).toEqual({
      buy: 1_100_000,
      sell: 1_050_000,
      mid: 1_075_000,
      priceAt: '2026-06-29T10:00:00Z',
    })
  })

  it('sends POST with operationName and query body', async () => {
    process.env.CERMATI_GRAPHQL_URL = 'https://edge.cermati.com/graphql'

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockGoldResponse,
    }) as any

    const { fetchGoldPrices } = await import('./cermati.js')
    await fetchGoldPrices()

    const [callUrl, callInit] = (global.fetch as any).mock.calls[0]
    expect(callUrl).toBe('https://edge.cermati.com/graphql')
    expect(callInit.method).toBe('POST')

    const body = JSON.parse(callInit.body)
    expect(body.operationName).toBe('GetGoldPrice')
    expect(body.query).toContain('getGoldPrice')
    expect(body.query).toContain('sellPrice')
  })

  it('sends Cookie header when CERMATI_COOKIE is set', async () => {
    process.env.CERMATI_GRAPHQL_URL = 'https://edge.cermati.com/graphql'
    process.env.CERMATI_COOKIE = 'session=abc123'

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockGoldResponse,
    }) as any

    const { fetchGoldPrices } = await import('./cermati.js')
    await fetchGoldPrices()

    const callInit = (global.fetch as any).mock.calls[0][1]
    expect(callInit.headers['cookie']).toBe('session=abc123')
  })

  it('returns {} on HTTP error', async () => {
    process.env.CERMATI_GRAPHQL_URL = 'https://edge.cermati.com/graphql'

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as any

    const { fetchGoldPrices } = await import('./cermati.js')
    const prices = await fetchGoldPrices()
    expect(prices).toEqual({})
  })

  it('returns {} on network error', async () => {
    process.env.CERMATI_GRAPHQL_URL = 'https://edge.cermati.com/graphql'

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any

    const { fetchGoldPrices } = await import('./cermati.js')
    const prices = await fetchGoldPrices()
    expect(prices).toEqual({})
  })

  it('returns {} when response typename is not GetGoldPrice_Response', async () => {
    process.env.CERMATI_GRAPHQL_URL = 'https://edge.cermati.com/graphql'

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: {
          getGoldPrice: {
            __typename: 'InternalServerError',
            errorCode: 'ERR_500',
            errorMessage: 'Something went wrong',
            isError: true,
          },
        },
      }),
    }) as any

    const { fetchGoldPrices } = await import('./cermati.js')
    const prices = await fetchGoldPrices()
    expect(prices).toEqual({})
  })

  it('uses default URL when CERMATI_GRAPHQL_URL is not set', async () => {
    delete process.env.CERMATI_GRAPHQL_URL

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockGoldResponse,
    }) as any

    const { fetchGoldPrices } = await import('./cermati.js')
    await fetchGoldPrices()

    const callUrl = (global.fetch as any).mock.calls[0][0]
    expect(callUrl).toBe('https://edge.cermati.com/graphql')
  })
})

describe('fetchFundNavs', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    delete process.env.CERMATI_MF_URL
    delete process.env.CERMATI_COOKIE
    vi.clearAllMocks()
  })

  it('returns fund records with mapped field names', async () => {
    process.env.CERMATI_MF_URL = 'https://invest.cermati.com/api/v2/mutual-funds/products'

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockFundPage0,
    }) as any

    const { fetchFundNavs } = await import('./cermati.js')
    const navs = await fetchFundNavs()

    expect(navs).toHaveLength(1)
    expect(navs[0].fund_code).toBe('MAMI')
    expect(navs[0].fund_name).toBe('Manulife Equity Fund')
    expect(navs[0].nav).toBe(12_500)
    expect(navs[0].nav_at).toBe('2026-06-29')
  })

  it('paginates until a page has fewer items than page size', async () => {
    process.env.CERMATI_MF_URL = 'https://invest.cermati.com/api/v2/mutual-funds/products'

    // Manufacture two full pages (100 items each) and one short final page
    const fullPage = (start: number) => ({
      data: Array.from({ length: 100 }, (_, i) => ({
        code: `FUND${start + i}`,
        name: `Fund ${start + i}`,
        currentNav: 10_000 + i,
        lastUpdatedNav: '2026-06-29T00:00:00Z',
      })),
    })
    const lastPage = {
      data: [
        { code: 'LAST', name: 'Last Fund', currentNav: 9_999, lastUpdatedNav: '2026-06-28T00:00:00Z' },
      ],
    }

    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => fullPage(0) })
      .mockResolvedValueOnce({ ok: true, json: async () => fullPage(100) })
      .mockResolvedValueOnce({ ok: true, json: async () => lastPage }) as any

    const { fetchFundNavs } = await import('./cermati.js')
    const navs = await fetchFundNavs()

    expect(navs).toHaveLength(201)   // 100 + 100 + 1
    expect((global.fetch as any).mock.calls).toHaveLength(3)
    expect(navs[200].fund_code).toBe('LAST')
  })

  it('uses 0-indexed page and size params in URL', async () => {
    process.env.CERMATI_MF_URL = 'https://invest.cermati.com/api/v2/mutual-funds/products'

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockFundPage0,
    }) as any

    const { fetchFundNavs } = await import('./cermati.js')
    await fetchFundNavs()

    const callUrl = (global.fetch as any).mock.calls[0][0]
    expect(callUrl).toContain('page=0')
    expect(callUrl).toContain('size=100')
    expect(callUrl).toContain('status=active_subsenabled')
  })

  it('truncates lastUpdatedNav to 10 chars for nav_at', async () => {
    process.env.CERMATI_MF_URL = 'https://invest.cermati.com/api/v2/mutual-funds/products'

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{
          code: 'ABCD',
          name: 'Test Fund',
          currentNav: 5000,
          lastUpdatedNav: '2026-06-29T12:34:56.789Z',
        }],
      }),
    }) as any

    const { fetchFundNavs } = await import('./cermati.js')
    const navs = await fetchFundNavs()
    expect(navs[0].nav_at).toBe('2026-06-29')
  })

  it('skips items without a code', async () => {
    process.env.CERMATI_MF_URL = 'https://invest.cermati.com/api/v2/mutual-funds/products'

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { code: 'VALID', name: 'Valid Fund', currentNav: 1000, lastUpdatedNav: '2026-06-29' },
          { name: 'No Code Fund', currentNav: 2000, lastUpdatedNav: '2026-06-29' },
        ],
      }),
    }) as any

    const { fetchFundNavs } = await import('./cermati.js')
    const navs = await fetchFundNavs()
    expect(navs).toHaveLength(1)
    expect(navs[0].fund_code).toBe('VALID')
  })

  it('returns [] on HTTP error', async () => {
    process.env.CERMATI_MF_URL = 'https://invest.cermati.com/api/v2/mutual-funds/products'

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({}),
    }) as any

    const { fetchFundNavs } = await import('./cermati.js')
    const navs = await fetchFundNavs()
    expect(navs).toEqual([])
  })

  it('returns [] on network error', async () => {
    process.env.CERMATI_MF_URL = 'https://invest.cermati.com/api/v2/mutual-funds/products'

    global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any

    const { fetchFundNavs } = await import('./cermati.js')
    const navs = await fetchFundNavs()
    expect(navs).toEqual([])
  })

  it('sends Cookie header when CERMATI_COOKIE is set', async () => {
    process.env.CERMATI_MF_URL = 'https://invest.cermati.com/api/v2/mutual-funds/products'
    process.env.CERMATI_COOKIE = 'session=xyz'

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockFundPage0,
    }) as any

    const { fetchFundNavs } = await import('./cermati.js')
    await fetchFundNavs()

    const callInit = (global.fetch as any).mock.calls[0][1]
    expect(callInit.headers['cookie']).toBe('session=xyz')
  })
})
