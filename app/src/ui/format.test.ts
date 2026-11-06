import { describe, expect, it } from 'vitest'
import { formatChange, formatCompact, formatDecimal, formatNumber, formatPeriod, numberFormat } from './format'

describe('formatting', () => {
  it('groups digits per locale', () => {
    expect(formatNumber(21749, 'en')).toBe('21,749')
    expect(formatNumber(21749, 'fr').replace(/\s/g, ' ')).toBe('21 749')
  })

  it('writes a sale period as months', () => {
    expect(formatPeriod('2023-01/2025-12', 'en')).toBe('Jan 2023 – Dec 2025')
    expect(formatPeriod('2023-01/2025-12', 'fr')).toMatch(/janv\.? 2023 – déc\.? 2025/)
    expect(formatPeriod('garbage', 'en')).toBeNull()
  })

  it('writes a signed percentage change', () => {
    expect(formatChange(3586, 3463, 'en')).toBe('-3%')
    expect(formatChange(1000, 1100, 'en')).toBe('+10%')
    expect(formatChange(1000, 1000, 'en')).toBe('0%')
  })

  it('shortens thousands for the phone legend', () => {
    expect(formatCompact(1500, 'en')).toBe('1.5k')
  })

  it('writes one decimal per locale', () => {
    expect(formatDecimal(3.84, 'en')).toBe('3.8')
    expect(formatDecimal(12, 'fr')).toBe('12,0')
  })

  it('builds each formatter once per locale and options', () => {
    expect(numberFormat('fr', { maximumFractionDigits: 0 })).toBe(numberFormat('fr', { maximumFractionDigits: 0 }))
    expect(numberFormat('fr', { maximumFractionDigits: 0 })).not.toBe(numberFormat('en', { maximumFractionDigits: 0 }))
    expect(numberFormat('fr')).not.toBe(numberFormat('fr', { maximumFractionDigits: 0 }))
  })
})
