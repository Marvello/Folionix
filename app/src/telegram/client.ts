import 'dotenv/config'

const MAX_RETRIES = 3
const CHUNK_LIMIT = 4000

export function chunkText(text: string, limit = CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }
    // Split at last newline within limit
    let splitAt = remaining.lastIndexOf('\n', limit)
    if (splitAt <= 0) splitAt = limit
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt).trimStart()
  }
  return chunks
}

export async function sendRequest(
  text: string,
  chatId: string,
  token: string,
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
        signal: AbortSignal.timeout(15_000),
      })
      if (res.ok) return true
      const body = await res.json()
      console.error(`[telegram] attempt ${attempt} failed:`, body)
    } catch (err) {
      console.error(`[telegram] attempt ${attempt} error:`, err)
    }
    if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, 1000 * attempt))
  }
  return false
}

export async function sendTelegram(text: string, chatId?: string): Promise<void> {
  const token = process.env.TELEGRAM_TOKEN
  const targetId = chatId ?? process.env.TELEGRAM_CHAT_ID
  if (!token || !targetId) {
    console.warn('[telegram] TELEGRAM_TOKEN or TELEGRAM_CHAT_ID not set — skipping')
    return
  }

  const chunks = chunkText(text)
  for (const chunk of chunks) {
    await sendRequest(chunk, targetId, token)
  }
}
