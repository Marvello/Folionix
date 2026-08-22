// Google News RSS items carry no real article content — the link is a JS-only
// redirect and the RSS "content" just repeats the headline. This provider
// resolves the real publisher URL via Google's batchexecute endpoint, then
// scrapes og:description / og:image from the publisher page. All best-effort:
// every step returns null on failure and the caller falls back to title-only.

const FETCH_TIMEOUT_MS = 8_000
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
const BATCHEXECUTE_URL = 'https://news.google.com/_/DotsSplashUi/data/batchexecute'

export interface ArticleMeta {
  description: string | null
  imageUrl: string | null
}

async function fetchText(url: string, init?: RequestInit): Promise<string | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, ...init?.headers },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

/** Pull the batchexecute decode params out of the Google News article page. */
export function extractDecodeParams(html: string): { id: string; ts: string; sg: string } | null {
  const id = html.match(/data-n-a-id="([^"]+)"/)?.[1]
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1]
  const sg = html.match(/data-n-a-sg="([^"]+)"/)?.[1]
  return id && ts && sg ? { id, ts, sg } : null
}

/** Pull the first non-Google URL out of a batchexecute response. */
export function extractDecodedUrl(body: string): string | null {
  const urls = body.match(/https?:\/\/[^"\\]+/g) ?? []
  return urls.find((u) => !u.includes('google.com') && !u.includes('gstatic.com')) ?? null
}

/** Extract og:description and og:image from a publisher page. */
export function extractOgMeta(html: string): ArticleMeta {
  const og = (prop: string): string | null => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']og:${prop}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:${prop}["']`,
      'i',
    )
    const m = html.match(re)
    return m ? (m[1] ?? m[2]) : null
  }
  const description = og('description')
  const image = og('image')
  return {
    description: description ? decodeHtmlEntities(description) : null,
    imageUrl: image && /^https?:\/\//i.test(image) ? image : null,
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
}

/** Resolve a news.google.com/rss/articles/… link to the publisher URL. */
export async function resolveGoogleNewsUrl(googleUrl: string): Promise<string | null> {
  const page = await fetchText(googleUrl)
  if (!page) return null
  const params = extractDecodeParams(page)
  if (!params) return null

  const inner = JSON.stringify([
    'garturlreq',
    [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1],
      'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    params.id, Number(params.ts), params.sg,
  ])
  const fReq = JSON.stringify([[['Fbv4je', inner, null, 'generic']]])

  const body = await fetchText(BATCHEXECUTE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: `f.req=${encodeURIComponent(fReq)}`,
  })
  if (!body) return null
  return extractDecodedUrl(body)
}

/**
 * Full enrichment for a Google News RSS link: resolve the publisher URL and
 * scrape its og:description / og:image. Returns null when any step fails.
 */
export async function fetchGoogleArticleMeta(googleUrl: string): Promise<ArticleMeta | null> {
  const realUrl = await resolveGoogleNewsUrl(googleUrl)
  if (!realUrl) return null
  const page = await fetchText(realUrl)
  if (!page) return null
  const meta = extractOgMeta(page)
  return meta.description || meta.imageUrl ? meta : null
}
