import { describe, expect, it } from 'vitest'
import { toGenAiSchema } from './gemini'
import { RESPONSE_SCHEMA } from '../../src/import/aiShared'

// The schema adapter is the one piece of the transport that can silently produce
// garbage: a wrong type name doesn't error, it just stops constraining the
// model, and the failure shows up as "the AI returned nonsense" much later.

describe('toGenAiSchema', () => {
  it('uppercases type names, which is the only real difference from our dialect', () => {
    expect(toGenAiSchema({ type: 'string' })).toEqual({ type: 'STRING' })
    expect(toGenAiSchema({ type: 'number', nullable: true })).toEqual({
      type: 'NUMBER',
      nullable: true,
    })
  })

  it('passes `required` straight through', () => {
    // Unlike the Firebase SDK's Schema.object(), which wanted the inverse list.
    expect(
      toGenAiSchema({
        type: 'object',
        properties: { name: { type: 'string' }, amount: { type: 'number' } },
        required: ['name'],
      }),
    ).toEqual({
      type: 'OBJECT',
      properties: { name: { type: 'STRING' }, amount: { type: 'NUMBER' } },
      required: ['name'],
    })
  })

  it('recurses through arrays', () => {
    expect(toGenAiSchema({ type: 'array', items: { type: 'string' } })).toEqual({
      type: 'ARRAY',
      items: { type: 'STRING' },
    })
  })

  it('converts the real parse schema without leaving a lowercase type behind', () => {
    const seen: string[] = []
    const walk = (node: unknown) => {
      if (!node || typeof node !== 'object') return
      const n = node as Record<string, unknown>
      if (typeof n.type === 'string') seen.push(n.type)
      if (n.properties) Object.values(n.properties).forEach(walk)
      if (n.items) walk(n.items)
    }
    walk(toGenAiSchema(RESPONSE_SCHEMA))

    expect(seen.length).toBeGreaterThan(5)
    expect(seen.every((t) => t === t.toUpperCase())).toBe(true)
  })
})
