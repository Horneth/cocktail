import { describe, expect, it } from 'vitest'
import { readShareParams } from './shared'

describe('readShareParams — Android share target', () => {
  it('returns null when no share fields are present', () => {
    expect(readShareParams('')).toBeNull()
    expect(readShareParams('?foo=bar')).toBeNull()
  })

  it('combines title, text and url into one block', () => {
    const out = readShareParams('?title=Daiquiri&text=A%20classic&url=https://youtu.be/abc')
    expect(out).toBe('Daiquiri\nA classic\nhttps://youtu.be/abc')
  })

  it('de-dupes when YouTube repeats the link in text and url', () => {
    const link = 'https://youtu.be/abc'
    const out = readShareParams(`?text=${encodeURIComponent(link)}&url=${encodeURIComponent(link)}`)
    expect(out).toBe(link)
  })

  it('works with only a url', () => {
    expect(readShareParams('?url=https%3A%2F%2Fyoutu.be%2Fxyz')).toBe('https://youtu.be/xyz')
  })
})
