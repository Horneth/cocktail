import { describe, expect, it } from 'vitest'
import { monthKey } from './usage'

describe('monthKey', () => {
  it('formats as YYYY-MM with a padded month', () => {
    expect(monthKey(new Date('2026-08-13T12:00:00Z'))).toBe('2026-08')
    expect(monthKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01')
    expect(monthKey(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12')
  })

  it('uses UTC, so a timezone cannot buy an extra month of allowance', () => {
    // 23:30 on Aug 31 in Auckland is still August 31 in UTC — a user who flies
    // west must not get their counter reset a day early.
    expect(monthKey(new Date('2026-08-31T23:30:00Z'))).toBe('2026-08')
    expect(monthKey(new Date('2026-09-01T00:30:00Z'))).toBe('2026-09')
  })
})
