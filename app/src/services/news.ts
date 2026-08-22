import 'dotenv/config'
import Parser from 'rss-parser'
import { callLlm, extractJson } from '../ai/llm'
import { getCachedSentiment, saveSentiment, saveNewsArticles, getCachedNewsUrls } from '../db/db'
import { fetchGoogleArticleMeta, type ArticleMeta } from '../providers/article'

export type Depth = 'LIGHT' | 'FULL' | 'DEEP'

// Article limits per analysis depth
const ARTICLE_LIMITS: Record<Depth, number> = { LIGHT: 3, FULL: 5, DEEP: 10 }

// Google News RSS base — hl/gl/ceid set to Indonesia for local-market news
const GOOGLE_NEWS_BASE = 'https://news.google.com/rss/search?hl=id&gl=ID&ceid=ID:id&q='

// Indonesian financial news RSS feeds
const INDONESIAN_RSS_FEEDS: Record<string, string> = {
  kontan: 'https://www.kontan.co.id/rss',
  cnbc_id: 'https://www.cnbcindonesia.com/market/rss',
  bisnis: 'https://www.bisnis.com/rss',
}

const parser = new Parser()

// The Indonesian financial feeds are the same 3 static URLs for every ticker —
// cache the parsed items so a portfolio run with N tickers fetches each feed
// once instead of N times. TTL matches how fresh we need the fallback to be.
const FEED_CACHE_TTL_MS = 15 * 60_000
const feedCache = new Map<string, { promise: Promise<Parser.Item[]>; fetchedAt: number }>()

function getCachedFeedItems(url: string): Promise<Parser.Item[]> {
  const cached = feedCache.get(url)
  if (cached && Date.now() - cached.fetchedAt < FEED_CACHE_TTL_MS) return cached.promise

  const promise = parser.parseURL(url).then((feed) => feed.items)
  promise.catch(() => feedCache.delete(url)) // don't cache failures — let the next call retry
  feedCache.set(url, { promise, fetchedAt: Date.now() })
  return promise
}

/**
 * Fetch news articles for an IDX ticker from Google News RSS (using the
 * Indonesian term 'saham' for local-market results) and supplement with
 * Indonesian financial RSS feeds filtered by ticker mention.
 *
 * Returns up to `ARTICLE_LIMITS[depth]` formatted article strings.
 */
export async function fetchNewsForTicker(ticker: string, depth: Depth): Promise<string[]> {
  const limit = ARTICLE_LIMITS[depth]
  const cleanTicker = ticker.replace('.JK', '')
  const articles: string[] = []
  const toCache: Array<{ headline: string; url: string; publishedAt?: string; summary?: string }> = []

  try {
    const url = `${GOOGLE_NEWS_BASE}${encodeURIComponent(cleanTicker + '+saham')}`
    const feed = await parser.parseURL(url)
    const items = feed.items.slice(0, limit)

    // Google News RSS carries no real snippet (its "content" repeats the
    // headline), so enrich each new article with og:description/og:image
    // scraped from the publisher page. Skip URLs already in news_cache —
    // enrichment costs ~3 HTTP round-trips per article.
    const known = await getCachedNewsUrls(items.map((i) => i.link).filter((l): l is string => !!l))
    const metas = await Promise.all(items.map((item): Promise<ArticleMeta | null> =>
      item.link && !known.has(item.link) ? fetchGoogleArticleMeta(item.link) : Promise.resolve(null),
    ))

    for (const [i, item] of items.entries()) {
      const meta = metas[i]
      const text = [item.title, meta?.description ?? item.contentSnippet].filter(Boolean).join(' — ')
      if (text) {
        articles.push(text)
        if (item.link && item.title) {
          const summary = meta
            ? `${meta.imageUrl ? `<img src="${meta.imageUrl}"/>` : ''}${meta.description ?? ''}` || undefined
            : undefined
          toCache.push({ headline: item.title, url: item.link, publishedAt: item.pubDate ?? undefined, summary })
        }
      }
    }
  } catch {
    // skip on RSS error; supplement feeds below may still provide articles
  }

  if (articles.length < limit) {
    for (const [, feedUrl] of Object.entries(INDONESIAN_RSS_FEEDS)) {
      if (articles.length >= limit) break
      try {
        const items = await getCachedFeedItems(feedUrl)
        const relevant = items.filter(
          (item) => item.title?.toUpperCase().includes(cleanTicker.toUpperCase()),
        )
        for (const item of relevant.slice(0, limit - articles.length)) {
          const text = [item.title, item.contentSnippet].filter(Boolean).join(' — ')
          if (text) {
            articles.push(text)
            if (item.link && item.title) {
              toCache.push({
                headline: item.title,
                url: item.link,
                publishedAt: item.pubDate ?? undefined,
                summary: item.content ?? item.contentSnippet ?? undefined,
              })
            }
          }
        }
      } catch {
        // skip individual feed failures
      }
    }
  }

  // Fire-and-forget cache write — don't block the caller. Cache is keyed by
  // the yahoo symbol (storage convention); cleanTicker is only for feed search.
  void saveNewsArticles(ticker, 'rss', toCache)

  return articles.slice(0, limit)
}

/**
 * Summarize a list of news articles for a ticker using the LLM.
 * Returns a 2-3 sentence HTML-formatted sentiment summary.
 * Checks the DB cache first (12h TTL) before calling the LLM.
 * Falls back to joining the first two article titles if the LLM fails.
 */
export async function summarizeNewsWithLlm(
  articles: string[],
  ticker: string,
  depth: Depth = 'FULL',
): Promise<string> {
  if (articles.length === 0) return ''

  const cleanTicker = ticker.replace('.JK', '')

  // Return cached sentiment if fresh enough (12h)
  // Sentiment cache keyed by yahoo symbol (storage convention)
  const cached = await getCachedSentiment(ticker, depth)
  if (cached) return withScoreHeader(cached.summary, cached.score)

  const articleText = articles.map((a, i) => `${i + 1}. ${a}`).join('\n')
  const prompt = [
    `You are an Indonesian stock-market news analyst. Analyze the news below for ${cleanTicker} stock.`,
    ``,
    `NEWS:`,
    articleText,
    ``,
    `Reply with JSON ONLY (no other text), in this exact format:`,
    `{`,
    `  "summary": "<2-3 sentence market-sentiment summary; HTML formatting <b>/<i> allowed>",`,
    `  "score": <integer -5 to +5, 0=neutral, positive=bullish, negative=bearish>,`,
    `  "themes": [<2-3 main themes in English>],`,
    `  "catalyst": <main positive catalyst as a string, or null>,`,
    `  "risk": <main risk as a string, or null>`,
    `}`,
  ].join('\n')

  try {
    const result = await callLlm(prompt, {
      system: 'You are a stock news analyst. Reply ONLY in JSON format.',
      temperature: 0.2,
    })
    const parsed = extractJson(result) as {
      summary?: unknown; score?: unknown; themes?: unknown; catalyst?: unknown; risk?: unknown
    } | null

    if (parsed && typeof parsed.summary === 'string' && parsed.summary.trim()) {
      const summary = parsed.summary.trim()
      const score = Math.max(-5, Math.min(5, Math.trunc(Number(parsed.score) || 0)))
      const themes = Array.isArray(parsed.themes)
        ? parsed.themes.slice(0, 3).map(String).join(', ') || null
        : null
      const catalyst = typeof parsed.catalyst === 'string' && parsed.catalyst.trim() ? parsed.catalyst.trim() : null
      const risk = typeof parsed.risk === 'string' && parsed.risk.trim() ? parsed.risk.trim() : null
      void saveSentiment(ticker, depth, summary, score, { themes, catalyst, risk })
      return withScoreHeader(summary, score)
    }

    // JSON parse failed — fall back to raw text + keyword score, no structured fields
    const upper = result.toUpperCase()
    const score = upper.includes('POSITIF') || upper.includes('BULLISH') ? 1
      : upper.includes('NEGATIF') || upper.includes('BEARISH') ? -1 : 0
    void saveSentiment(ticker, depth, result, score)
    return withScoreHeader(result, score)
  } catch {
    return articles.slice(0, 2).join('. ')
  }
}

// Prepend a compact numeric-score header so the analysis prompt can act on the
// sentiment magnitude, not just the prose (score is otherwise lost after summary).
function withScoreHeader(summary: string, score: number): string {
  const label =
    score >= 3 ? 'strongly bullish' :
    score <= -3 ? 'strongly bearish' :
    score > 0 ? 'mildly bullish' :
    score < 0 ? 'mildly bearish' : 'neutral'
  const s = score > 0 ? `+${score}` : `${score}`
  return `Sentiment score: ${s}/5 (${label}).\n${summary}`
}
