import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the Firebase bootstrap so no real SDK/network is touched — we only verify
// the transport wiring (model JSON -> StructuredImport / bottles), the payload
// contract, and the error paths.
vi.mock('../auth/firebase', () => ({ callAi: vi.fn() }))
import { callAi } from '../auth/firebase'
import {
  CloudAIError,
  cloudIdentifyBottles,
  cloudJudgeDuplicates,
  cloudParse,
  cloudReconcileBottles,
  latestUsage,
} from './cloudAI'
import type { DupeQuery } from './aiShared'
import { MAX_IMAGE_BYTES, MAX_PARSE_CHARS, MAX_SCAN_IMAGES } from './limits'

/** Resolve the next callable invocation with this model JSON. */
function mockCall(json: unknown, usage: unknown = null) {
  vi.mocked(callAi).mockResolvedValue({ json, usage })
}

/** What the callable was invoked with: [name, data]. */
const sentTo = (n = 0) => vi.mocked(callAi).mock.calls[n]

afterEach(() => vi.clearAllMocks())

describe('cloudParse', () => {
  it('maps model JSON into StructuredImport[] via the shared mappers', async () => {
    mockCall({
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
    })
    const out = await cloudParse('Daiquiri recipe text')
    expect(out).toHaveLength(1)
    expect(out[0].main.name).toBe('Daiquiri')
    expect(out[0].main.spirit).toBe('rum')
    expect(out[0].main.ingredients).toHaveLength(2)
  })

  it('sends the raw text to aiParse and nothing else', async () => {
    mockCall({ recipes: [{ name: 'x', ingredients: [{ name: 'rum', unit: 'oz', amount: 2 }] }] })
    await cloudParse('some text')
    expect(sentTo()).toEqual(['aiParse', { text: 'some text' }])
  })

  it('throws CloudAIError when the model finds no recipes', async () => {
    mockCall({ recipes: [] })
    await expect(cloudParse('x')).rejects.toThrow(/No recipes/)
  })

  it('surfaces a server message rather than a generic one', async () => {
    vi.mocked(callAi).mockRejectedValue(
      Object.assign(new Error("That's a lot of AI for one month."), {
        code: 'functions/resource-exhausted',
      }),
    )
    await expect(cloudParse('x')).rejects.toThrow(/lot of AI for one month/)
  })

  it('caches the tier and counters the server reports', async () => {
    const usage = { tier: 'pro', lifetime: { parse: 4, scan: 1 }, month: { parse: 2, scan: 0 } }
    mockCall({ recipes: [{ name: 'x', ingredients: [{ name: 'rum', unit: 'oz', amount: 2 }] }] }, usage)
    await cloudParse('x')
    expect(latestUsage()).toEqual(usage)
  })
})

describe('cloudIdentifyBottles', () => {
  const IMG = 'data:image/jpeg;base64,QUJD'

  it('dedupes and lets our categorizer win', async () => {
    mockCall({ bottles: [{ name: 'Tanqueray' }, { name: 'Tanqueray' }] })
    await expect(cloudIdentifyBottles([IMG])).resolves.toEqual([
      { name: 'Tanqueray', category: 'gin' },
    ])
  })

  it('sends split parts, not data URLs — image.ts must stay out of the Functions build', async () => {
    mockCall({ bottles: [] })
    await cloudIdentifyBottles([IMG])
    expect(sentTo()).toEqual([
      'aiIdentifyBottles',
      { images: [{ mimeType: 'image/jpeg', data: 'QUJD' }] },
    ])
  })

  it('rejects a photo that is not a data URL', async () => {
    await expect(cloudIdentifyBottles(['https://example.com/shelf.jpg'])).rejects.toBeInstanceOf(
      CloudAIError,
    )
    expect(callAi).not.toHaveBeenCalled()
  })

  it('rejects an empty image list without calling out', async () => {
    await expect(cloudIdentifyBottles([])).rejects.toBeInstanceOf(CloudAIError)
    expect(callAi).not.toHaveBeenCalled()
  })
})

describe('cloudJudgeDuplicates', () => {
  const QUERIES: DupeQuery[] = [
    { index: 0, name: 'Rum Sour', aka: ['Daiquiri'], candidates: ['Daiquiri'] },
    { index: 1, name: 'Negroni', aka: [], candidates: [] },
  ]

  it('sends only names — never ingredients or ids — and only for shortlisted drinks', async () => {
    // This is the privacy contract: the library never leaves the device beyond
    // the handful of names a local pass already matched.
    mockCall({ verdicts: [] })
    await cloudJudgeDuplicates(QUERIES)
    expect(sentTo()).toEqual([
      'aiJudgeDuplicates',
      { queries: [{ index: 0, name: 'Rum Sour', aka: ['Daiquiri'], candidates: ['Daiquiri'] }] },
    ])
  })

  it('returns matched verdicts', async () => {
    mockCall({
      verdicts: [{ index: 0, relation: 'same', match: 'Daiquiri', reason: 'same drink' }],
    })
    await expect(cloudJudgeDuplicates(QUERIES)).resolves.toEqual([
      { index: 0, relation: 'same', match: 'Daiquiri', reason: 'same drink' },
    ])
  })

  it('never calls out when nothing matched locally', async () => {
    await expect(cloudJudgeDuplicates([QUERIES[1]])).resolves.toEqual([])
    await expect(cloudJudgeDuplicates([])).resolves.toEqual([])
    expect(callAi).not.toHaveBeenCalled()
  })

  it('degrades to no verdicts rather than throwing — a failed check must not block an import', async () => {
    mockCall('not the expected shape')
    await expect(cloudJudgeDuplicates(QUERIES)).resolves.toEqual([])

    vi.mocked(callAi).mockRejectedValueOnce(new Error('offline'))
    await expect(cloudJudgeDuplicates(QUERIES)).resolves.toEqual([])
  })
})

describe('cloudReconcileBottles', () => {
  const inputs = [
    { detected: 'Plantation 3 Stars', candidates: ['Plantation Three Stars White Rum'] },
  ]

  it('maps the model verdict back onto what we asked about', async () => {
    mockCall({
      matches: [
        {
          detected: 'Plantation 3 Stars',
          verdict: 'same',
          match: 'Plantation Three Stars White Rum',
          canonicalName: 'Plantation 3 Stars',
        },
      ],
    })
    await expect(cloudReconcileBottles(inputs)).resolves.toEqual([
      {
        detected: 'Plantation 3 Stars',
        verdict: 'same',
        match: 'Plantation Three Stars White Rum',
        canonicalName: 'Plantation 3 Stars',
      },
    ])
  })

  it('sends only the detected names and their candidates', async () => {
    mockCall({ matches: [] })
    await cloudReconcileBottles(inputs)
    expect(sentTo()).toEqual(['aiReconcileBottles', { inputs }])
  })

  it('never calls out when nothing has a candidate', async () => {
    // A scan into an empty bar must cost exactly one AI call, not two.
    expect(await cloudReconcileBottles([{ detected: 'Campari', candidates: [] }])).toEqual([])
    expect(await cloudReconcileBottles([])).toEqual([])
    expect(callAi).not.toHaveBeenCalled()
  })

  it('degrades to no verdicts rather than throwing — a failed pass 2 must not break the scan', async () => {
    mockCall('nope')
    await expect(cloudReconcileBottles(inputs)).resolves.toEqual([])

    vi.mocked(callAi).mockRejectedValueOnce(new Error('429 resource-exhausted'))
    await expect(cloudReconcileBottles(inputs)).resolves.toEqual([])
  })
})

// The server enforces these too, and it is the side that gets billed. Checking
// them here only saves a round trip and gives a better message.
describe('request limits', () => {
  const jpeg = (bytes: number) => `data:image/jpeg;base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`

  it('rejects an over-long paste before calling out', async () => {
    await expect(cloudParse('x'.repeat(MAX_PARSE_CHARS + 1))).rejects.toBeInstanceOf(CloudAIError)
    expect(callAi).not.toHaveBeenCalled()
  })

  it('rejects more photos than a scan allows, before calling out', async () => {
    const many = Array.from({ length: MAX_SCAN_IMAGES + 1 }, () => jpeg(100))
    await expect(cloudIdentifyBottles(many)).rejects.toBeInstanceOf(CloudAIError)
    expect(callAi).not.toHaveBeenCalled()
  })

  it('rejects a photo over the byte budget', async () => {
    await expect(cloudIdentifyBottles([jpeg(MAX_IMAGE_BYTES + 1024)])).rejects.toBeInstanceOf(
      CloudAIError,
    )
    expect(callAi).not.toHaveBeenCalled()
  })
})
