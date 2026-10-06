import 'dotenv/config'

const MAX_ATTEMPTS = 3
const CHUNK_LIMIT = 4000   // headroom under Telegram's 4096 for the closing tags chunkText appends
const TAG_RE = /<(\/?)(b|i|u|s|code|pre)>/g

/** Tags left open at the end of `html`, outermost first (input is sanitizeHtml output: bare tags only). */
function openTags(html: string): string[] {
  const stack: string[] = []
  for (const [, close, tag] of html.matchAll(TAG_RE)) {
    if (!close) stack.push(tag)
    else if (stack.at(-1) === tag) stack.pop()
  }
  return stack
}

/**
 * Split HTML into Telegram-sized chunks without breaking markup: prefer a newline,
 * never cut inside a tag or entity, and close/reopen tags that span a boundary —
 * Telegram rejects a chunk whose tags don't balance.
 */
export function chunkText(text: string, limit = CHUNK_LIMIT): string[] {
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf('\n', limit)
    if (splitAt <= 0) {
      // Hard cut: back off to before an unterminated tag or entity in the window.
      const win = remaining.slice(0, limit)
      const lt = win.lastIndexOf('<')
      const amp = win.lastIndexOf('&')
      splitAt = limit
      if (lt > win.lastIndexOf('>')) splitAt = lt
      else if (amp > win.lastIndexOf(';')) splitAt = amp
      if (splitAt <= 0) splitAt = limit
    }
    const head = remaining.slice(0, splitAt)
    const open = openTags(head)
    chunks.push(head + open.map(t => `</${t}>`).reverse().join(''))
    remaining = open.map(t => `<${t}>`).join('') + remaining.slice(splitAt).trimStart()
  }
  chunks.push(remaining)
  return chunks
}

const decodeEntities = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/** HTML → plain text, for the fallback when Telegram can't parse our markup. */
export function toPlainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ''))
}

/**
 * POST one message. Retries only what can succeed on retry (network, 429 with its
 * retry_after, 5xx). A 400 entity-parse error is resent once as plain text so the
 * alert still arrives. Returns whether Telegram accepted the message.
 */
export async function sendRequest(text: string, chatId: string, token: string): Promise<boolean> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  let body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let waitMs = 1000 * attempt
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) return true
      const err = await res.json().catch(() => ({})) as { description?: string; parameters?: { retry_after?: number } }
      console.error(`[telegram] attempt ${attempt} failed (${res.status}):`, err.description ?? err)
      if (res.status === 400 && body.parse_mode && /parse entities/i.test(err.description ?? '')) {
        body = { chat_id: chatId, text: toPlainText(text) }
        attempt--   // the plain-text resend doesn't count against transient retries
        continue
      }
      if (res.status === 429) waitMs = (err.parameters?.retry_after ?? 1) * 1000
      else if (res.status < 500) return false
    } catch (err) {
      console.error(`[telegram] attempt ${attempt} error:`, err)
    }
    if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, waitMs))
  }
  return false
}

/** Send `text` (Telegram HTML), chunked. Returns true only if every chunk was delivered. */
export async function sendTelegram(text: string, chatId?: string): Promise<boolean> {
  const token = process.env.TELEGRAM_TOKEN
  const targetId = chatId ?? process.env.TELEGRAM_CHAT_ID
  if (!token || !targetId) {
    console.warn('[telegram] TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not set — skipping')
    return false
  }

  let ok = true
  for (const chunk of chunkText(text)) {
    ok = (await sendRequest(chunk, targetId, token)) && ok
  }
  return ok
}
