import { describe, it, expect, vi, afterEach } from 'vitest'
import { chunkText, sendRequest, toPlainText } from './client'

describe('chunkText', () => {
  it('keeps short text whole', () => {
    expect(chunkText('<b>hi</b>')).toEqual(['<b>hi</b>'])
  })

  it('closes and reopens tags that span a chunk boundary', () => {
    const chunks = chunkText(`<b>${'a'.repeat(30)}\n${'b'.repeat(30)}</b>`, 40)
    expect(chunks).toEqual([`<b>${'a'.repeat(30)}</b>`, `<b>${'b'.repeat(30)}</b>`])
  })

  it('never cuts inside a tag or an entity', () => {
    for (const c of chunkText(`${'x'.repeat(18)}<i>y</i>&amp;${'z'.repeat(30)}`, 20)) {
      expect(c).not.toMatch(/<[^>]*$|&[a-z]*$/)
    }
  })
})

describe('sendRequest', () => {
  afterEach(() => vi.unstubAllGlobals())
  const reply = (status: number, body: object = {}) => new Response(JSON.stringify(body), { status })

  it('resends as plain text when Telegram cannot parse the HTML', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(400, { description: "Bad Request: can't parse entities" }))
      .mockResolvedValueOnce(reply(200))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendRequest('<b>P&amp;L</b>', '1', 't')).toBe(true)
    const second = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(second).toEqual({ chat_id: '1', text: 'P&L' })
  })

  it('does not retry other 4xx and reports failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(403, { description: 'Forbidden' }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendRequest('x', '1', 't')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('toPlainText', () => {
  it('strips tags and decodes entities', () => {
    expect(toPlainText('<b>R&amp;D &lt; 5</b>')).toBe('R&D < 5')
  })
})
