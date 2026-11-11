import { describe, it, expect } from 'vitest'
import { renderEmailHtml } from './email'

describe('renderEmailHtml', () => {
  it('escapes raw HTML instead of passing it through', async () => {
    const html = await renderEmailHtml('hi <img src=x onerror=alert(1)> <script>x()</script>')
    expect(html).not.toMatch(/<img|<script/)
    expect(html).toContain('&lt;img')
  })

  it('keeps http(s) links, drops javascript: and data: hrefs', async () => {
    const html = await renderEmailHtml('[ok](https://example.com/a?b=1) [bad](javascript:alert(1)) [d](data:text/html,x)')
    expect(html).toContain('<a href="https://example.com/a?b=1">ok</a>')
    expect(html).not.toMatch(/javascript:|data:text/)
    expect(html).toContain('bad')
  })

  it('renders images as alt text (no remote loads)', async () => {
    const html = await renderEmailHtml('![chart](https://tracker.example/p.png)')
    expect(html).not.toContain('<img')
    expect(html).toContain('chart')
  })

  it('still renders normal markdown', async () => {
    expect(await renderEmailHtml('# Title\n\n**bold**')).toMatch(/<h1>Title<\/h1>[\s\S]*<strong>bold<\/strong>/)
  })
})
