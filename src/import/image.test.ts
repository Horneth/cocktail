import { describe, expect, it } from 'vitest'
import { dataUrlBytes, splitDataUrl } from './image'

// Only the pure helpers are covered here; the canvas path needs a real browser
// and is exercised by the shelf scan in `scripts/smoke.mjs`.

describe('splitDataUrl', () => {
  it('splits a base64 data URL into mime type and payload', () => {
    expect(splitDataUrl('data:image/jpeg;base64,QUJD')).toEqual({
      mimeType: 'image/jpeg',
      data: 'QUJD',
    })
  })

  it('returns null for anything that is not one', () => {
    expect(splitDataUrl('https://example.com/a.jpg')).toBeNull()
    expect(splitDataUrl('data:image/jpeg,QUJD')).toBeNull()
  })
})

describe('dataUrlBytes', () => {
  it('reports the decoded size, not the encoded length', () => {
    // "ABC" -> QUJD, no padding; base64 is 4 chars per 3 bytes.
    expect(dataUrlBytes('data:image/jpeg;base64,QUJD')).toBe(3)
  })

  it('accounts for padding', () => {
    expect(dataUrlBytes('data:image/jpeg;base64,QQ==')).toBe(1)
    expect(dataUrlBytes('data:image/jpeg;base64,QUI=')).toBe(2)
  })

  it('is zero for a malformed URL rather than throwing', () => {
    expect(dataUrlBytes('nonsense')).toBe(0)
  })
})
