import { describe, it, expect } from 'vitest'
import { validatePrice, validateLots, validateGrams } from './bot'

describe('validatePrice', () => {
  it('passes valid price', () => expect(() => validatePrice(7200)).not.toThrow())
  it('rejects zero', () => expect(() => validatePrice(0)).toThrow('AVG_PRICE must be > 0'))
  it('rejects negative', () => expect(() => validatePrice(-1)).toThrow('AVG_PRICE must be > 0'))
  it('rejects overflow', () => expect(() => validatePrice(1e10)).toThrow('AVG_PRICE too large'))
})

describe('validateLots', () => {
  it('passes valid lots', () => expect(() => validateLots(5)).not.toThrow())
  it('rejects zero', () => expect(() => validateLots(0)).toThrow('LOTS must be >= 1'))
  it('rejects overflow', () => expect(() => validateLots(1_000_001)).toThrow('LOTS too large'))
})

describe('validateGrams', () => {
  it('passes valid grams', () => expect(() => validateGrams(10)).not.toThrow())
  it('rejects zero', () => expect(() => validateGrams(0)).toThrow('GRAMS must be > 0'))
  it('rejects overflow', () => expect(() => validateGrams(100_001)).toThrow('GRAMS too large'))
})
