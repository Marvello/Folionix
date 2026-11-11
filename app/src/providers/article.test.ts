import { describe, it, expect } from 'vitest'
import { extractDecodeParams, extractDecodedUrl, extractOgMeta, isGoogleNewsLink } from './article'
import { readCapped } from '../utils/http'

describe('article provider', () => {
  it('extractDecodeParams pulls id/ts/sg from a Google News page', () => {
    const html = '<c-wiz data-n-a-id="CBMiABC" data-n-a-ts="1784073050" data-n-a-sg="AZta1JZK">'
    expect(extractDecodeParams(html)).toEqual({ id: 'CBMiABC', ts: '1784073050', sg: 'AZta1JZK' })
  })

  it('extractDecodeParams returns null when params missing', () => {
    expect(extractDecodeParams('<html><body>nothing</body></html>')).toBeNull()
  })

  it('extractDecodedUrl skips google/gstatic URLs', () => {
    const body = ')]}\'\n[[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://news.google.com/x\\"]"]],'
      + '"https://www.gstatic.com/img.png","https://market.bisnis.com/read/123/artikel"'
    expect(extractDecodedUrl(body)).toBe('https://market.bisnis.com/read/123/artikel')
  })

  it('extractOgMeta reads og:description and og:image in either attribute order', () => {
    const html = [
      '<meta property="og:description" content="Emiten tambang menghadapi tekanan biaya &amp; laba positif.">',
      '<meta content="https://cdn.example.com/a.jpg" property="og:image" />',
    ].join('\n')
    expect(extractOgMeta(html)).toEqual({
      description: 'Emiten tambang menghadapi tekanan biaya & laba positif.',
      imageUrl: 'https://cdn.example.com/a.jpg',
    })
  })

  it('extractOgMeta stays fast on hostile input (no quadratic backtracking)', () => {
    const t = performance.now()
    expect(extractOgMeta('<meta '.repeat(50_000))).toEqual({ description: null, imageUrl: null })
    expect(extractOgMeta('<meta property="og:description" ' + 'x'.repeat(300_000))).toEqual({ description: null, imageUrl: null })
    expect(performance.now() - t).toBeLessThan(200)
  })

  it('extractOgMeta ignores tags after </head>', () => {
    const html = '<head><title>x</title></head><body><meta property="og:description" content="body"></body>'
    expect(extractOgMeta(html).description).toBeNull()
  })

  it('readCapped stops at the byte cap', async () => {
    const big = new Response('a'.repeat(2_000_000)).body!
    expect((await readCapped(big, 1024)).length).toBe(1024)
    expect(await readCapped(new Response('héllo').body!, 1024)).toBe('héllo')
  })

  it('isGoogleNewsLink only accepts https://news.google.com', () => {
    expect(isGoogleNewsLink('https://news.google.com/rss/articles/CBMi')).toBe(true)
    expect(isGoogleNewsLink('http://news.google.com/x')).toBe(false)
    expect(isGoogleNewsLink('https://news.google.com.evil.io/x')).toBe(false)
    expect(isGoogleNewsLink('http://169.254.169.254/')).toBe(false)
    expect(isGoogleNewsLink('not a url')).toBe(false)
  })

  it('extractOgMeta rejects non-http og:image and returns nulls when absent', () => {
    const html = '<meta property="og:image" content="/relative/img.jpg">'
    expect(extractOgMeta(html)).toEqual({ description: null, imageUrl: null })
  })
})
