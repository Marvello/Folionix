import { describe, it, expect, vi } from 'vitest'
vi.mock('../db/db.js', () => ({}))
vi.mock('./fundamentals.js', () => ({}))
const { selectPeerGroups, peerNotes } = await import('./peers')

const c = (ticker: string, sub: string, ind: string) =>
  ({ ticker, name: null, sector: 'S', sub_sector: null, industry: ind, sub_industry: sub, board: null, listed_at: null })

describe('selectPeerGroups', () => {
  const banks = Array.from({ length: 12 }, (_, i) => c(`B${i}.JK`, 'Bank', 'Bank'))
  const caps = new Map(banks.map((b, i) => [b.ticker, 1000 - i]))   // B0 largest

  it('takes the top 8 by market cap in the sub-industry, excluding the stock itself', () => {
    const rows = selectPeerGroups(['B0.JK'], banks, caps)
    expect(rows.map((r) => r.peer)).toEqual(['B1.JK', 'B2.JK', 'B3.JK', 'B4.JK', 'B5.JK', 'B6.JK', 'B7.JK', 'B8.JK'])
    expect(rows[0]).toMatchObject({ ticker: 'B0.JK', rank: 1, basis: 'sub_industry', group_name: 'Bank' })
  })

  it('widens to the industry when the sub-industry has fewer than 3 others', () => {
    const cls = [c('TLKM.JK', 'Integrated', 'Telco'), c('ISAT.JK', 'Wireless', 'Telco'), c('EXCL.JK', 'Wireless', 'Telco'), c('FREN.JK', 'Wireless', 'Telco')]
    const rows = selectPeerGroups(['TLKM.JK'], cls, new Map([['ISAT.JK', 3], ['EXCL.JK', 2], ['FREN.JK', 1]]))
    expect(rows.map((r) => r.peer)).toEqual(['ISAT.JK', 'EXCL.JK', 'FREN.JK'])
    expect(rows[0]!.basis).toBe('industry')
  })

  it('skips candidates without a market cap and unclassified holdings', () => {
    expect(selectPeerGroups(['B0.JK'], banks, new Map([['B1.JK', 5]])).map((r) => r.peer)).toEqual(['B1.JK'])
    expect(selectPeerGroups(['NOPE.JK'], banks, caps)).toEqual([])
  })
})

describe('peerNotes', () => {
  it('lists every holding a peer belongs to and skips peers that are held', () => {
    const notes = peerNotes([
      { ticker: 'BBCA.JK', peer: 'BBNI.JK', rank: 3, basis: 'sub_industry', group_name: 'Bank' },
      { ticker: 'BMRI.JK', peer: 'BBNI.JK', rank: 2, basis: 'sub_industry', group_name: 'Bank' },
      { ticker: 'BBCA.JK', peer: 'BMRI.JK', rank: 1, basis: 'sub_industry', group_name: 'Bank' },
    ], new Set(['BBCA.JK', 'BMRI.JK']))
    expect(notes).toEqual(new Map([['BBNI.JK', 'Peer of BBCA, BMRI · Bank']]))
  })
})
