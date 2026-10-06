import { describe, it, expect, vi } from 'vitest'

vi.mock('ai', () => ({
  streamText: vi.fn().mockReturnValue({ text: Promise.resolve('HOLD — market stable.') }),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn().mockReturnValue(
    Object.assign(vi.fn().mockReturnValue({ id: 'openai:gpt-4' }), {
      chat: vi.fn().mockReturnValue({ id: 'openai:gpt-4' }),
    }),
  ),
}))

describe('callLlm', () => {
  it('returns text from primary', async () => {
    process.env.LLM_BACKEND = 'ollama'
    process.env.LLM_MODEL = 'llama3.1'
    process.env.LLM_API_BASE = 'http://localhost:11434'
    const { callLlm } = await import('./llm.js')
    const result = await callLlm('Analyze BBCA stock')
    expect(result).toBe('HOLD — market stable.')
  })

  it('bounds every call with a timeout and a single retry layer', async () => {
    const { streamText } = await import('ai')
    const { callLlm } = await import('./llm.js')
    await callLlm('Analyze BBCA stock')
    const opts = vi.mocked(streamText).mock.calls.at(-1)![0] as { maxRetries: number; timeout: { totalMs: number; chunkMs: number } }
    expect(opts.maxRetries).toBe(2)
    expect(opts.timeout.totalMs).toBeGreaterThan(0)
    expect(opts.timeout.chunkMs).toBeGreaterThan(0)
  })

  it('falls through to the fallback target when the primary fails', async () => {
    process.env.LLM_FALLBACK_BACKEND = 'openai'
    const { streamText } = await import('ai')
    vi.mocked(streamText)
      .mockReturnValueOnce({ text: Promise.reject(new Error('timeout')) } as never)
      .mockReturnValueOnce({ text: Promise.resolve('from fallback') } as never)
    const { callLlm } = await import('./llm.js')
    expect(await callLlm('x')).toBe('from fallback')
    delete process.env.LLM_FALLBACK_BACKEND
  })
})

describe('extractRecommendation', () => {
  it('extracts known keywords from the REKOMENDASI line', async () => {
    const { extractRecommendation } = await import('./llm.js')
    for (const kw of ['AVERAGE DOWN', 'TAKE PROFIT', 'CUT LOSS', 'HOLD', 'MONITOR', 'BUY', 'TRIM']) {
      expect(extractRecommendation(`analysis…\nREKOMENDASI: ${kw}`)).toBe(kw)
    }
    expect(extractRecommendation('REKOMENDASI: no clear signal')).toBe('UNKNOWN')
  })

  it('returns UNKNOWN instead of guessing from prose when the line is missing', async () => {
    const { extractRecommendation } = await import('./llm.js')
    expect(extractRecommendation('Not a BUY yet — HOLD for now')).toBe('UNKNOWN')
  })

  it('rejects a keyword outside the allowed set for the context', async () => {
    const { extractRecommendation, WATCHLIST_RECOMMENDATIONS } = await import('./llm.js')
    expect(extractRecommendation('REKOMENDASI: CUT LOSS', WATCHLIST_RECOMMENDATIONS)).toBe('UNKNOWN')
    expect(extractRecommendation('REKOMENDASI: MONITOR', WATCHLIST_RECOMMENDATIONS)).toBe('MONITOR')
  })

  it('prefers the REKOMENDASI line over keywords in the prose', async () => {
    const { extractRecommendation } = await import('./llm.js')
    const text = 'The stock could HOLD or you might BUY.\nREKOMENDASI: MONITOR'
    expect(extractRecommendation(text)).toBe('MONITOR')
  })

  it('picks the earliest keyword, not the first in list order', async () => {
    const { extractRecommendation } = await import('./llm.js')
    // "HOLD" is earlier in the keyword list than "MONITOR" but appears later here.
    expect(extractRecommendation('REKOMENDASI: MONITOR closely — do not HOLD yet')).toBe('MONITOR')
    expect(extractRecommendation('REKOMENDASI: BUY, do not HOLD')).toBe('BUY')
  })
})

describe('cleanForTelegram', () => {
  it('preserves allowed HTML tags', async () => {
    const { cleanForTelegram } = await import('./llm.js')
    const raw = '<b>Buy</b> <script>evil()</script> <i>now</i>'
    const clean = cleanForTelegram(raw)
    expect(clean).toContain('<b>Buy</b>')
    expect(clean).not.toContain('<script>')
  })

  it('strips disallowed tags but keeps allowed ones', async () => {
    const { cleanForTelegram } = await import('./llm.js')
    const input = '<div><b>Hello</b><script>alert(1)</script><i>world</i></div>'
    const result = cleanForTelegram(input)
    expect(result).toContain('<b>Hello</b>')
    expect(result).toContain('<i>world</i>')
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('<div>')
  })

  it('strips markdown fences', async () => {
    const { cleanForTelegram } = await import('./llm.js')
    const result = cleanForTelegram('```html\n<b>hi</b>\n```')
    expect(result).toBe('<b>hi</b>')
  })

  it('normalizes excessive newlines', async () => {
    const { cleanForTelegram } = await import('./llm.js')
    const result = cleanForTelegram('line1\n\n\n\nline2')
    expect(result).toBe('line1\n\nline2')
  })

  it('converts headings to bold text', async () => {
    const { cleanForTelegram } = await import('./llm.js')
    const result = cleanForTelegram('<h2>Section Title</h2>')
    expect(result).toContain('<b>Section Title</b>')
    expect(result).not.toContain('<h2>')
  })
})

describe('extractJson', () => {
  it('extracts JSON from markdown code block', async () => {
    const { extractJson } = await import('./llm.js')
    const raw = 'Here is the data:\n```json\n{"action": "BUY"}\n```'
    const result = extractJson(raw)
    expect(result).toEqual({ action: 'BUY' })
  })

  it('extracts bare JSON', async () => {
    const { extractJson } = await import('./llm.js')
    expect(extractJson('{"foo": 1}')).toEqual({ foo: 1 })
  })

  it('returns null on invalid JSON', async () => {
    const { extractJson } = await import('./llm.js')
    expect(extractJson('not json at all')).toBeNull()
  })

  it('handles braces inside string values without unbalancing the span', async () => {
    const { extractJson } = await import('./llm.js')
    const raw = 'Result: {"summary": "price up {slightly} today", "score": -3} trailing text'
    expect(extractJson(raw)).toEqual({ summary: 'price up {slightly} today', score: -3 })
  })
})
