import { describe, it, expect } from 'vitest'
import { fetchPublicText, isBlockedAddress, isPublicUrl, isSafePathSegment, readCappedBytes } from './http'

describe('http utils', () => {
  it('blocks private, loopback, link-local, CGNAT and mapped addresses', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.51', '169.254.169.254',
      '100.64.222.78', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', 'nonsense']) {
      expect(isBlockedAddress(a), a).toBe(true)
    }
    for (const a of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) expect(isBlockedAddress(a), a).toBe(false)
  })

  it('isPublicUrl rejects non-http schemes and private hosts', async () => {
    expect(await isPublicUrl(new URL('file:///etc/passwd'))).toBe(false)
    expect(await isPublicUrl(new URL('http://127.0.0.1:5432/'))).toBe(false)
    expect(await isPublicUrl(new URL('http://[::1]/'))).toBe(false)
    expect(await isPublicUrl(new URL('http://localhost/'))).toBe(false)
  })

  it('fetchPublicText refuses a private target without fetching', async () => {
    expect(await fetchPublicText('http://169.254.169.254/latest/meta-data', 1024, { timeoutMs: 1000 })).toBeNull()
  })

  it('isSafePathSegment rejects dot segments', () => {
    expect(isSafePathSegment('SR018')).toBe(true)
    expect(isSafePathSegment('fund.v2')).toBe(true)
    for (const s of ['', '.', '..']) expect(isSafePathSegment(s)).toBe(false)
  })

  it('readCappedBytes stops at the cap', async () => {
    expect((await readCappedBytes(new Response(new Uint8Array(1_000_000)).body!, 4096)).length).toBe(4096)
    expect((await readCappedBytes(new Response('abc').body!, 4096)).length).toBe(3)
  })
})
