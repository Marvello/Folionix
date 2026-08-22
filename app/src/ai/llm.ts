import 'dotenv/config'
import { streamText, LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { sanitizeHtml } from '../../../lib/format'
import { withRetry } from '../utils/retry'

// ── CONFIG ─────────────────────────────────────────────────────────────────
// Primary backend. LLM_* are canonical; OLLAMA_* kept as legacy fallbacks.

interface LlmTarget {
  model: LanguageModel
  maxOutputTokens?: number
}

function resolveTarget(
  backend: string | undefined,
  model: string,
  apiBase: string | undefined,
  apiKey: string | undefined,
  numPredict: number | undefined,
): LlmTarget {
  const effectiveBackend = (backend ?? 'ollama').trim().toLowerCase()
  let langModel: LanguageModel

  // Both backends speak the OpenAI wire format. Use .chat() explicitly:
  // provider(model) defaults to the Responses API (/responses), which
  // LiteLLM/Ollama answer with a shape the SDK rejects ("Invalid JSON
  // response"); /chat/completions is what they actually support.
  if (effectiveBackend === 'ollama') {
    // Native Ollama via its OpenAI-compatible endpoint — ollama-ai-provider
    // is spec v1 and unsupported by ai>=5, which made every call fail.
    const base = apiBase ?? process.env.OLLAMA_URL ?? 'http://localhost:11434'
    const provider = createOpenAI({ baseURL: `${base}/v1`, apiKey: apiKey ?? 'ollama' })
    langModel = provider.chat(model)
  } else {
    // litellm or any OpenAI-compatible endpoint
    const openai = createOpenAI({ baseURL: apiBase, apiKey: apiKey ?? 'none' })
    langModel = openai.chat(model)
  }

  return { model: langModel, maxOutputTokens: numPredict }
}

// Targets are pure functions of these env vars; rebuilding a provider on every
// callLlm (N tickers × 12 personas) is wasted work. Memoise, keyed on the env
// so a test that changes backend/model still gets a fresh target.
let _targetsCache: { key: string; targets: LlmTarget[] } | null = null

function buildTargets(): LlmTarget[] {
  const key = [
    process.env.LLM_BACKEND, process.env.LLM_MODEL, process.env.LLM_API_BASE, process.env.LLM_API_KEY,
    process.env.LLM_NUM_PREDICT, process.env.OLLAMA_NUM_PREDICT, process.env.OLLAMA_MODEL, process.env.OLLAMA_URL,
    process.env.LLM_FALLBACK_BACKEND, process.env.LLM_FALLBACK_MODEL,
    process.env.LLM_FALLBACK_API_BASE, process.env.LLM_FALLBACK_API_KEY,
  ].join('|')
  if (_targetsCache?.key === key) return _targetsCache.targets

  const numPredict = Number(
    process.env.LLM_NUM_PREDICT ?? process.env.OLLAMA_NUM_PREDICT ?? 4096,
  )

  const primary = resolveTarget(
    process.env.LLM_BACKEND,
    process.env.LLM_MODEL ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',
    process.env.LLM_API_BASE ?? process.env.OLLAMA_URL,
    process.env.LLM_API_KEY,
    numPredict,
  )

  const fallbackBackend = process.env.LLM_FALLBACK_BACKEND
  if (!fallbackBackend) {
    _targetsCache = { key, targets: [primary] }
    return _targetsCache.targets
  }

  const fallback = resolveTarget(
    fallbackBackend,
    process.env.LLM_FALLBACK_MODEL ?? process.env.LLM_MODEL ?? process.env.OLLAMA_MODEL ?? 'qwen2.5:7b',
    process.env.LLM_FALLBACK_API_BASE ?? process.env.LLM_API_BASE ?? process.env.OLLAMA_URL,
    process.env.LLM_FALLBACK_API_KEY ?? process.env.LLM_API_KEY,
    numPredict,
  )

  _targetsCache = { key, targets: [primary, fallback] }
  return _targetsCache.targets
}

// ── CALL LLM ───────────────────────────────────────────────────────────────

export async function callLlm(
  prompt: string,
  opts?: { system?: string; temperature?: number },
): Promise<string> {
  // If no system prompt provided, split on first '===' line
  let system = opts?.system
  let userPrompt = prompt

  if (system === undefined) {
    const lines = prompt.trim().split('\n')
    const splitIdx = lines.findIndex((ln) => ln.startsWith('==='))
    if (splitIdx !== -1) {
      system = lines.slice(0, splitIdx).join('\n').trim() || 'You are a helpful stock analyst.'
      userPrompt = lines.slice(splitIdx).join('\n').trim() || prompt
    } else {
      system = 'You are a helpful stock analyst.'
    }
  }

  const targets = buildTargets()
  let lastError: unknown

  for (const target of targets) {
    try {
      // Stream rather than generateText: gateways in front of this (omniroute)
      // answer text/event-stream even for a non-streamed request, which
      // generateText rejects as "Invalid JSON response". Consuming the stream
      // and awaiting the full text works against streaming and plain
      // OpenAI-compatible servers alike.
      const text = await withRetry(async () => {
        const result = streamText({
          model: target.model,
          prompt: userPrompt,
          system,
          temperature: opts?.temperature ?? 0.3,
          maxOutputTokens: target.maxOutputTokens,
        })
        return await result.text
      }, 3, 1000)
      if (text?.trim()) return text
    } catch (err) {
      lastError = err
    }
  }

  throw new Error(`callLlm: all targets failed. Last error: ${lastError}`)
}

// ── EXTRACT RECOMMENDATION ─────────────────────────────────────────────────

// Order matters: multi-word keywords before their single-word prefixes
const RECOMMENDATION_KEYWORDS = [
  'AVERAGE DOWN',
  'TAKE PROFIT',
  'CUT LOSS',
  'HOLD',
  'MONITOR',
  'BUY',
  'TRIM',
]

export function extractRecommendation(text: string): string {
  const upper = text.toUpperCase()

  // Check for explicit REKOMENDASI line first
  const rekoMatch = upper.match(/REKOMENDASI[^\n]*/)
  const scopes = rekoMatch ? [rekoMatch[0], upper] : [upper]

  for (const scope of scopes) {
    // Pick the keyword that appears EARLIEST in the scope, not the first in list
    // order — otherwise "MONITOR, do not HOLD" wrongly resolves to HOLD and
    // poisons the recommendation ledger. Tie on position → longer (multi-word) wins.
    let best: { kw: string; index: number } | null = null
    for (const kw of RECOMMENDATION_KEYWORDS) {
      // Word-boundary matching so e.g. WITHHOLD doesn't match HOLD
      const m = new RegExp(`\\b${kw.replace(' ', '\\s+')}\\b`).exec(scope)
      if (!m) continue
      if (!best || m.index < best.index || (m.index === best.index && kw.length > best.kw.length)) {
        best = { kw, index: m.index }
      }
    }
    if (best) return best.kw
  }
  return 'UNKNOWN'
}

// ── CLEAN FOR TELEGRAM HTML ────────────────────────────────────────────────

export function cleanForTelegram(raw: string): string {
  let s = raw

  // Strip markdown code fences
  s = s.replace(/```(?:html)?\n?/gi, '').replace(/```\n?/g, '')

  // Remove structural block tags that aren't supported (keep content)
  s = s.replace(/<\/?(?:html|body|head|div|section|article|main)[^>]*>/gi, '')
  s = s.replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, '$1')

  // Convert remaining block elements to newlines
  s = s.replace(/<\/p>/gi, '\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '<b>$1</b>\n')
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '• $1\n')
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, '')

  // Let sanitizeHtml strip everything not in the Telegram allowlist
  s = sanitizeHtml(s)

  // Normalize whitespace
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

// ── EXTRACT JSON ───────────────────────────────────────────────────────────

function findJsonSpan(text: string): string | null {
  const candidates: Array<[number, string, string]> = []
  const openIdx = text.indexOf('{')
  const arrIdx = text.indexOf('[')
  if (openIdx !== -1) candidates.push([openIdx, '{', '}'])
  if (arrIdx !== -1) candidates.push([arrIdx, '[', ']'])
  if (candidates.length === 0) return null

  candidates.sort((a, b) => a[0] - b[0])
  const [start, opener, closer] = candidates[0]

  let depth = 0
  let inStr = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    // Braces/brackets inside a JSON string are literal text, not structure —
    // ignore them so a summary value like "up {slightly}" can't unbalance depth.
    if (inStr) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === opener) depth++
    else if (ch === closer) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function extractJson(raw: string): unknown {
  let text = raw.trim()

  // Strip markdown fences
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  // If it starts with a JSON container, parse directly
  if (text.startsWith('{') || text.startsWith('[')) {
    try {
      return JSON.parse(text)
    } catch (err) {
      console.warn('[llm] JSON parse failed on direct block:', err instanceof Error ? err.message : err)
      // fall through to span extraction
    }
  }

  // Find first balanced JSON span
  const span = findJsonSpan(text)
  if (span) {
    try {
      return JSON.parse(span)
    } catch (err) {
      console.warn('[llm] JSON parse failed on span:', err instanceof Error ? err.message : err)
      // fall through
    }
  }

  return null
}
