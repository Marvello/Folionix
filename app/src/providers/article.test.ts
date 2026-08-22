import { describe, it, expect } from 'vitest'
import { extractDecodeParams, extractDecodedUrl, extractOgMeta } from './article'

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

  it('extractOgMeta rejects non-http og:image and returns nulls when absent', () => {
    const html = '<meta property="og:image" content="/relative/img.jpg">'
    expect(extractOgMeta(html)).toEqual({ description: null, imageUrl: null })
  })
})
