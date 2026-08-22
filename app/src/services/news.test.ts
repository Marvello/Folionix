import { describe, it, expect, vi } from 'vitest'

vi.mock('rss-parser', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        parseURL: vi.fn().mockResolvedValue({
          items: [
            { title: 'BBCA profit rises 12%', contentSnippet: 'Bank Central Asia reports strong earnings.', link: 'https://example.com/bbca-profit' },
            { title: 'Banking sector outlook positive', contentSnippet: 'Analysts upgrade sector.', link: 'https://example.com/banking-outlook' },
          ],
        }),
      }
    }),
  }
})

const LLM_JSON = JSON.stringify({
  summary: 'Positive sentiment: strong earnings and sector upgrade.',
  score: 3,
  themes: ['earnings', 'banking sector'],
  catalyst: 'Profit rises 12%',
  risk: null,
})

vi.mock('../ai/llm.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ai/llm.js')>()
  return {
    extractJson: actual.extractJson,
    callLlm: vi.fn().mockResolvedValue(LLM_JSON),
  }
})

vi.mock('../db/db.js', () => ({
  getCachedSentiment: vi.fn().mockResolvedValue(null),
  saveSentiment: vi.fn(),
  saveNewsArticles: vi.fn(),
  getCachedNewsUrls: vi.fn().mockResolvedValue(new Set()),
}))

vi.mock('../providers/article.js', () => ({
  fetchGoogleArticleMeta: vi.fn().mockResolvedValue({
    description: 'Bank Central Asia posts strong quarterly earnings, beating analyst estimates.',
    imageUrl: 'https://img.example.com/bbca.jpg',
  }),
}))

describe('news', () => {
  it('fetchNewsForTicker returns article list', async () => {
    const { fetchNewsForTicker } = await import('./news.js')
    const articles = await fetchNewsForTicker('BBCA', 'LIGHT')
    expect(articles.length).toBeGreaterThan(0)
    expect(articles[0]).toContain('BBCA')
  })

  it('fetchNewsForTicker caches enriched og meta as summary', async () => {
    const { saveNewsArticles } = await import('../db/db.js')
    vi.mocked(saveNewsArticles).mockClear()

    const { fetchNewsForTicker } = await import('./news.js')
    await fetchNewsForTicker('BBCA', 'LIGHT')

    expect(saveNewsArticles).toHaveBeenCalledWith(
      'BBCA', 'rss',
      expect.arrayContaining([
        expect.objectContaining({
          headline: 'BBCA profit rises 12%',
          summary: '<img src="https://img.example.com/bbca.jpg"/>Bank Central Asia posts strong quarterly earnings, beating analyst estimates.',
        }),
      ]),
    )
  })

  it('falls back to title-only cache entry when enrichment fails', async () => {
    const { fetchGoogleArticleMeta } = await import('../providers/article.js')
    vi.mocked(fetchGoogleArticleMeta).mockResolvedValue(null)

    const { saveNewsArticles } = await import('../db/db.js')
    vi.mocked(saveNewsArticles).mockClear()

    const { fetchNewsForTicker } = await import('./news.js')
    await fetchNewsForTicker('BBCA', 'LIGHT')

    expect(saveNewsArticles).toHaveBeenCalledWith(
      'BBCA', 'rss',
      expect.arrayContaining([
        expect.objectContaining({ headline: 'BBCA profit rises 12%', summary: undefined }),
      ]),
    )
    vi.mocked(fetchGoogleArticleMeta).mockResolvedValue({
      description: 'Bank Central Asia posts strong quarterly earnings, beating analyst estimates.',
      imageUrl: 'https://img.example.com/bbca.jpg',
    })
  })

  it('summarizeNewsWithLlm parses JSON and saves structured sentiment', async () => {
    const { summarizeNewsWithLlm } = await import('./news.js')
    const { saveSentiment } = await import('../db/db.js')
    vi.mocked(saveSentiment).mockClear()

    const sentiment = await summarizeNewsWithLlm(['Good news', 'More good news'], 'BBCA')
    expect(sentiment).toBe('Sentiment score: +3/5 (strongly bullish).\nPositive sentiment: strong earnings and sector upgrade.')
    // raw_output stays the clean summary; the score header is added only on return.
    expect(saveSentiment).toHaveBeenCalledWith(
      'BBCA', 'FULL', 'Positive sentiment: strong earnings and sector upgrade.', 3,
      { themes: 'earnings, banking sector', catalyst: 'Profit rises 12%', risk: null },
    )
  })

  it('falls back to raw text + keyword score when LLM output is not JSON', async () => {
    const { callLlm } = await import('../ai/llm.js')
    vi.mocked(callLlm).mockResolvedValueOnce('Sentimen BULLISH untuk saham ini.')

    const { summarizeNewsWithLlm } = await import('./news.js')
    const { saveSentiment } = await import('../db/db.js')
    vi.mocked(saveSentiment).mockClear()

    const sentiment = await summarizeNewsWithLlm(['Some news'], 'BBCA')
    expect(sentiment).toBe('Sentiment score: +1/5 (mildly bullish).\nSentimen BULLISH untuk saham ini.')
    expect(saveSentiment).toHaveBeenCalledWith('BBCA', 'FULL', 'Sentimen BULLISH untuk saham ini.', 1)
  })

  it('returns cached sentiment without calling LLM when cache is warm', async () => {
    const { getCachedSentiment } = await import('../db/db.js')
    vi.mocked(getCachedSentiment).mockResolvedValueOnce({ summary: 'Cached positive sentiment.', score: 4 })

    const { summarizeNewsWithLlm } = await import('./news.js')
    const { callLlm } = await import('../ai/llm.js')
    vi.mocked(callLlm).mockClear()

    const result = await summarizeNewsWithLlm(['Article 1'], 'BBCA', 'FULL')
    expect(result).toBe('Sentiment score: +4/5 (strongly bullish).\nCached positive sentiment.')
    expect(callLlm).not.toHaveBeenCalled()
  })
})
