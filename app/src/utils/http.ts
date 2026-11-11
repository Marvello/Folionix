// Fetch helpers for third-party URLs: byte caps (huge / gzip-bomb bodies can't
// exhaust memory) and an SSRF guard for URLs that come from scraped content.
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

/** '.'/'..' survive encodeURIComponent and would walk the URL path. */
export const isSafePathSegment = (s: string): boolean => s.length > 0 && !/^\.{1,2}$/.test(s)

/** Read a body stream, stopping (and cancelling) once maxBytes are in. */
export async function readCappedBytes(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<Uint8Array> {
  const reader = body.getReader()
  const parts: Uint8Array[] = []
  let bytes = 0
  while (bytes < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = value.subarray(0, maxBytes - bytes)
    parts.push(chunk)
    bytes += chunk.length
  }
  await reader.cancel().catch(() => {})
  const out = new Uint8Array(bytes)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

export async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readCappedBytes(body, maxBytes))
}

// Private, loopback, link-local, CGNAT (tailnet), multicast/reserved.
const blocked = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3],
] as const) blocked.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [['::', 127], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) {
  blocked.addSubnet(net, prefix, 'ipv6')
}

export function isBlockedAddress(addr: string): boolean {
  const v4 = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1] // IPv4-mapped IPv6
  if (v4) return blocked.check(v4, 'ipv4')
  const fam = isIP(addr)
  return fam === 0 || blocked.check(addr, fam === 4 ? 'ipv4' : 'ipv6')
}

/** http(s) URL whose host resolves only to public addresses. */
export async function isPublicUrl(url: URL): Promise<boolean> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  const host = url.hostname.replace(/^\[|\]$/g, '')
  try {
    const addrs = await lookup(host, { all: true })
    return addrs.length > 0 && addrs.every((a) => !isBlockedAddress(a.address))
  } catch {
    return false
  }
}

/**
 * GET a scraped/third-party URL: every hop (redirects followed by hand, max 5)
 * must pass isPublicUrl, and the body is capped. null on any failure.
 * ponytail: DNS is checked, then fetch resolves again (rebinding window);
 * pin the resolved IP via an undici Agent `connect.lookup` if that ever matters.
 */
export async function fetchPublicText(
  rawUrl: string, maxBytes: number, init: RequestInit & { timeoutMs: number },
): Promise<string | null> {
  try {
    let url = new URL(rawUrl)
    const signal = AbortSignal.timeout(init.timeoutMs)
    for (let hop = 0; hop <= 5; hop++) {
      if (!(await isPublicUrl(url))) return null
      const res = await fetch(url, { ...init, redirect: 'manual', signal })
      const loc = res.headers.get('location')
      if (res.status >= 300 && res.status < 400 && loc) {
        await res.body?.cancel().catch(() => {})
        url = new URL(loc, url)
        continue
      }
      if (!res.ok || !res.body) return null
      return await readCapped(res.body, maxBytes)
    }
    return null
  } catch {
    return null
  }
}
