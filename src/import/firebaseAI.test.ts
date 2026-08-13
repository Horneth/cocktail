import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the Firebase bootstrap so no real SDK/network is touched — we only verify
// the transport wiring (model JSON -> StructuredImport / bottles) and error paths.
vi.mock('../auth/firebase', () => ({ getGeminiModel: vi.fn() }))
import { getGeminiModel } from '../auth/firebase'
import {
  CloudAIError,
  firebaseIdentifyBottles,
  firebaseJudgeDuplicates,
  firebaseParse,
  firebaseReconcileBottles,
} from './firebaseAI'
import type { DupeQuery } from './aiShared'
import { MAX_IMAGE_BYTES, MAX_PARSE_CHARS, MAX_SCAN_IMAGES } from './limits'

type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } }

/** Mock the model and hand back the spy, so tests can assert what was sent. */
function mockModel(jsonText: string) {
  const generateContent = vi.fn(async (_request: string | ContentPart[]) => ({
    response: { text: () => jsonText },
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(getGeminiModel).mockResolvedValue({ generateContent } as any)
  return generateContent
}

afterEach(() => vi.clearAllMocks())

describe('firebaseParse', () => {
  it('maps model JSON into StructuredImport[] via the shared mappers', async () => {
    mockModel(
      JSON.stringify({
        recipes: [
          {
            name: 'Daiquiri',
            spirit: 'rum',
            ingredients: [
              { name: 'White rum', unit: 'oz', amount: 2 },
              { name: 'Lime juice', unit: 'oz', amount: 0.75 },
            ],
          },
        ],
      }),
    )
    const out = await firebaseParse('Daiquiri recipe text')
    expect(out).toHaveLength(1)
    expect(out[0].main.name).toBe('Daiquiri')
    expect(out[0].main.spirit).toBe('rum')
    expect(out[0].main.ingredients).toHaveLength(2)
  })

  it('throws CloudAIError on malformed JSON', async () => {
    mockModel('definitely not json')
    await expect(firebaseParse('x')).rejects.toBeInstanceOf(CloudAIError)
  })

  it('throws CloudAIError when the model finds no recipes', async () => {
    mockModel(JSON.stringify({ recipes: [] }))
    await expect(firebaseParse('x')).rejects.toThrow(/No recipes/)
  })
})

describe('firebaseIdentifyBottles', () => {
  const IMG = 'data:image/jpeg;base64,QUJD'

  it('dedupes and lets our categorizer win', async () => {
    mockModel(JSON.stringify({ bottles: [{ name: 'Tanqueray' }, { name: 'Tanqueray' }] }))
    const out = await firebaseIdentifyBottles([IMG])
    expect(out).toEqual([{ name: 'Tanqueray', category: 'gin' }])
  })

  it('sends each photo as an inlineData part alongside the prompt', async () => {
    const generateContent = mockModel(JSON.stringify({ bottles: [] }))
    await firebaseIdentifyBottles([IMG])

    const parts = generateContent.mock.calls[0][0] as ContentPart[]
    expect(parts[0]).toHaveProperty('text')
    expect(parts).toContainEqual({ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } })
  })

  it('rejects a photo that is not a data URL', async () => {
    // Parts are built before the model handle is requested, so this never calls out.
    await expect(firebaseIdentifyBottles(['https://example.com/shelf.jpg'])).rejects.toBeInstanceOf(
      CloudAIError,
    )
  })

  it('rejects an empty image list without calling the model', async () => {
    await expect(firebaseIdentifyBottles([])).rejects.toBeInstanceOf(CloudAIError)
    expect(getGeminiModel).not.toHaveBeenCalled()
  })
})

describe('firebaseJudgeDuplicates', () => {
  const QUERIES: DupeQuery[] = [
    { index: 0, name: 'Rum Sour', aka: ['Daiquiri'], candidates: ['Daiquiri'] },
    { index: 1, name: 'Negroni', aka: [], candidates: [] },
  ]

  it('sends only names — never ingredients or ids — and only for shortlisted drinks', async () => {
    // This is the privacy contract: the library never leaves the device beyond
    // the handful of names a local pass already matched.
    const generateContent = mockModel(JSON.stringify({ verdicts: [] }))
    await firebaseJudgeDuplicates(QUERIES)

    const sent = generateContent.mock.calls[0][0] as string
    const payload = JSON.parse(sent.slice(sent.indexOf('[')))
    expect(payload).toEqual([
      { index: 0, name: 'Rum Sour', aka: ['Daiquiri'], candidates: ['Daiquiri'] },
    ])
  })

  it('returns matched verdicts', async () => {
    mockModel(
      JSON.stringify({
        verdicts: [{ index: 0, relation: 'same', match: 'Daiquiri', reason: 'same drink' }],
      }),
    )
    await expect(firebaseJudgeDuplicates(QUERIES)).resolves.toEqual([
      { index: 0, relation: 'same', match: 'Daiquiri', reason: 'same drink' },
    ])
  })

  it('never calls the model when nothing matched locally', async () => {
    await expect(firebaseJudgeDuplicates([QUERIES[1]])).resolves.toEqual([])
    await expect(firebaseJudgeDuplicates([])).resolves.toEqual([])
    expect(getGeminiModel).not.toHaveBeenCalled()
  })

  it('degrades to no verdicts rather than throwing — a failed check must not block an import', async () => {
    mockModel('not json at all')
    await expect(firebaseJudgeDuplicates(QUERIES)).resolves.toEqual([])

    vi.mocked(getGeminiModel).mockRejectedValueOnce(new Error('offline'))
    await expect(firebaseJudgeDuplicates(QUERIES)).resolves.toEqual([])
  })
})

describe('firebaseReconcileBottles', () => {
  const inputs = [{ detected: 'Plantation 3 Stars', candidates: ['Plantation Three Stars White Rum'] }]

  it('maps the model verdict back onto what we asked about', async () => {
    mockModel(
      JSON.stringify({
        matches: [
          {
            detected: 'Plantation 3 Stars',
            verdict: 'same',
            match: 'Plantation Three Stars White Rum',
            canonicalName: 'Plantation 3 Stars',
          },
        ],
      }),
    )
    const out = await firebaseReconcileBottles(inputs)
    expect(out).toEqual([
      {
        detected: 'Plantation 3 Stars',
        verdict: 'same',
        match: 'Plantation Three Stars White Rum',
        canonicalName: 'Plantation 3 Stars',
      },
    ])
  })

  it('sends only the detected names and their candidates', async () => {
    const generateContent = mockModel(JSON.stringify({ matches: [] }))
    await firebaseReconcileBottles(inputs)
    const prompt = generateContent.mock.calls[0][0] as string
    expect(prompt).toContain('Plantation 3 Stars')
    expect(prompt).toContain('Plantation Three Stars White Rum')
  })

  it('never calls the model when nothing has a candidate', async () => {
    // A scan into an empty bar must cost exactly one AI call, not two.
    expect(await firebaseReconcileBottles([{ detected: 'Campari', candidates: [] }])).toEqual([])
    expect(await firebaseReconcileBottles([])).toEqual([])
    expect(getGeminiModel).not.toHaveBeenCalled()
  })

  it('degrades to no verdicts rather than throwing — a failed pass 2 must not break the scan', async () => {
    mockModel('not json')
    await expect(firebaseReconcileBottles(inputs)).resolves.toEqual([])

    vi.mocked(getGeminiModel).mockRejectedValueOnce(new Error('429 resource-exhausted'))
    await expect(firebaseReconcileBottles(inputs)).resolves.toEqual([])
  })
})

// Every input below is pasted or photographed by the user, so an uncapped call
// bills for an unbounded number of tokens. These are cost bounds, not polish.
describe('request limits', () => {
  const jpeg = (bytes: number) => `data:image/jpeg;base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`

  it('rejects an over-long paste before reaching the model', async () => {
    mockModel('{}')
    await expect(firebaseParse('x'.repeat(MAX_PARSE_CHARS + 1))).rejects.toBeInstanceOf(CloudAIError)
    expect(getGeminiModel).not.toHaveBeenCalled()
  })

  it('rejects more photos than a scan allows, before reaching the model', async () => {
    mockModel('{"bottles":[]}')
    const many = Array.from({ length: MAX_SCAN_IMAGES + 1 }, () => jpeg(100))
    await expect(firebaseIdentifyBottles(many)).rejects.toBeInstanceOf(CloudAIError)
    expect(getGeminiModel).not.toHaveBeenCalled()
  })

  it('rejects a photo over the byte budget', async () => {
    mockModel('{"bottles":[]}')
    await expect(firebaseIdentifyBottles([jpeg(MAX_IMAGE_BYTES + 1024)])).rejects.toBeInstanceOf(
      CloudAIError,
    )
    expect(getGeminiModel).not.toHaveBeenCalled()
  })

  it('caps output tokens on every call', async () => {
    mockModel('{"recipes":[]}')
    await firebaseParse('Daiquiri').catch(() => {})
    mockModel('{"bottles":[]}')
    await firebaseIdentifyBottles([jpeg(100)])
    mockModel('{"results":[]}')
    await firebaseJudgeDuplicates([{ index: 0, name: 'Daiquiri', aka: [], candidates: ['Daiquiri'] }])
    mockModel('{"matches":[]}')
    await firebaseReconcileBottles([{ detected: 'Campari', candidates: ['Campari'] }])

    expect(vi.mocked(getGeminiModel).mock.calls).toHaveLength(4)
    for (const [config] of vi.mocked(getGeminiModel).mock.calls) {
      expect(config.maxOutputTokens).toBeGreaterThan(0)
    }
  })
})
