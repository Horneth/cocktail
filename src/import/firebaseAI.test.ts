import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the Firebase bootstrap so no real SDK/network is touched — we only verify
// the transport wiring (model JSON -> StructuredImport / bottles) and error paths.
vi.mock('../auth/firebase', () => ({ getTemplateModel: vi.fn() }))
import { getTemplateModel } from '../auth/firebase'
import {
  CloudAIError,
  firebaseIdentifyBottles,
  firebaseJudgeDuplicates,
  firebaseParse,
  firebaseReconcileBottles,
} from './firebaseAI'
import type { DupeQuery } from './aiShared'
import { GLASSES, METHODS, TAG_KEYS } from '../domain/vocab'
import { MAX_IMAGE_BYTES, MAX_PARSE_CHARS, MAX_SCAN_IMAGES } from './limits'

/**
 * Mock the server-template handle. All four calls run prompts published in the
 * Firebase project, so what we assert is the template id and the variables we
 * fill it with — the prompts and their configs live in the console now.
 */
function mockTemplate(jsonText: string) {
  const generateContent = vi.fn(
    async (_templateId: string, _vars: Record<string, unknown>) => ({
      response: { text: () => jsonText },
    }),
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(getTemplateModel).mockResolvedValue({ generateContent } as any)
  return generateContent
}

afterEach(() => vi.clearAllMocks())

describe('firebaseParse', () => {
  it('maps model JSON into StructuredImport[] via the shared mappers', async () => {
    mockTemplate(
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

  // Moved here from vocab.test.ts, which used to assert this against the PROMPT
  // constant. The prompt now lives in the console, so the request variables are
  // where the invariant is observable: the model must never be told about a
  // vocabulary the pickers don't offer — the mismatch vocab.ts exists to fix.
  it('sends the vocabularies from vocab.ts, so the model and the pickers agree', async () => {
    const generateContent = mockTemplate(JSON.stringify({ recipes: [] }))
    await firebaseParse('Daiquiri').catch(() => {})

    const [, vars] = generateContent.mock.calls[0] as [string, Record<string, string>]
    for (const tag of TAG_KEYS) expect(vars.tagVocab).toContain(tag)
    for (const method of METHODS) expect(vars.methods).toContain(method)
    for (const glass of GLASSES) expect(vars.glasses).toContain(glass)
  })

  it('throws CloudAIError on malformed JSON', async () => {
    mockTemplate('definitely not json')
    await expect(firebaseParse('x')).rejects.toBeInstanceOf(CloudAIError)
  })

  it('throws CloudAIError when the model finds no recipes', async () => {
    mockTemplate(JSON.stringify({ recipes: [] }))
    await expect(firebaseParse('x')).rejects.toThrow(/No recipes/)
  })

})

describe('firebaseIdentifyBottles', () => {
  const IMG = 'data:image/jpeg;base64,QUJD'

  it('dedupes and lets our categorizer win', async () => {
    mockTemplate(JSON.stringify({ bottles: [{ name: 'Tanqueray' }, { name: 'Tanqueray' }] }))
    const out = await firebaseIdentifyBottles([IMG])
    expect(out).toEqual([{ name: 'Tanqueray', category: 'gin' }])
  })

  it('runs the published vision template, passing photos as inline data', async () => {
    const generateContent = mockTemplate(JSON.stringify({ bottles: [] }))
    await firebaseIdentifyBottles([IMG])

    const [templateId, vars] = generateContent.mock.calls[0]
    // The id ships in the bundle, so a rename is a code change — pin it.
    expect(templateId).toBe('cocktail-vision-v1-0-0')
    // `contents`, not `data` — the template's {{media}} helper names these
    // fields, so a rename here breaks the call in a way only a 500 reveals.
    expect(vars).toEqual({ photos: [{ mimeType: 'image/jpeg', contents: 'QUJD' }] })
    // The prompt itself now lives in the Firebase project, not in this payload.
    expect(JSON.stringify(vars)).not.toContain('home bar or liquor shelf')
  })

  it('rejects a photo that is not a data URL', async () => {
    // Photos are validated before the model handle is requested, so this never calls out.
    await expect(firebaseIdentifyBottles(['https://example.com/shelf.jpg'])).rejects.toBeInstanceOf(
      CloudAIError,
    )
  })

  it('rejects an empty image list without calling the model', async () => {
    await expect(firebaseIdentifyBottles([])).rejects.toBeInstanceOf(CloudAIError)
    expect(getTemplateModel).not.toHaveBeenCalled()
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
    const generateContent = mockTemplate(JSON.stringify({ verdicts: [] }))
    await firebaseJudgeDuplicates(QUERIES)

    const [templateId, vars] = generateContent.mock.calls[0]
    expect(templateId).toBe('cocktail-dupes-v1-0-0')
    expect(vars).toEqual({
      entries: [{ index: 0, name: 'Rum Sour', aka: ['Daiquiri'], candidates: ['Daiquiri'] }],
    })
  })

  it('returns matched verdicts', async () => {
    mockTemplate(
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
    expect(getTemplateModel).not.toHaveBeenCalled()
  })

  it('degrades to no verdicts rather than throwing — a failed check must not block an import', async () => {
    mockTemplate('not json at all')
    await expect(firebaseJudgeDuplicates(QUERIES)).resolves.toEqual([])

    vi.mocked(getTemplateModel).mockRejectedValueOnce(new Error('offline'))
    await expect(firebaseJudgeDuplicates(QUERIES)).resolves.toEqual([])
  })
})

describe('firebaseReconcileBottles', () => {
  const inputs = [{ detected: 'Plantation 3 Stars', candidates: ['Plantation Three Stars White Rum'] }]

  it('maps the model verdict back onto what we asked about', async () => {
    mockTemplate(
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
    const generateContent = mockTemplate(JSON.stringify({ matches: [] }))
    await firebaseReconcileBottles(inputs)
    const [templateId, vars] = generateContent.mock.calls[0]
    expect(templateId).toBe('cocktail-reconcile-v1-0-0')
    expect(vars).toEqual({
      detections: [
        { detected: 'Plantation 3 Stars', candidates: ['Plantation Three Stars White Rum'] },
      ],
    })
  })

  it('never calls the model when nothing has a candidate', async () => {
    // A scan into an empty bar must cost exactly one AI call, not two.
    expect(await firebaseReconcileBottles([{ detected: 'Campari', candidates: [] }])).toEqual([])
    expect(await firebaseReconcileBottles([])).toEqual([])
    expect(getTemplateModel).not.toHaveBeenCalled()
  })

  it('degrades to no verdicts rather than throwing — a failed pass 2 must not break the scan', async () => {
    mockTemplate('not json')
    await expect(firebaseReconcileBottles(inputs)).resolves.toEqual([])

    vi.mocked(getTemplateModel).mockRejectedValueOnce(new Error('429 resource-exhausted'))
    await expect(firebaseReconcileBottles(inputs)).resolves.toEqual([])
  })
})

// Every input below is pasted or photographed by the user, so an uncapped call
// bills for an unbounded number of tokens. These are cost bounds, not polish.
describe('request limits', () => {
  const jpeg = (bytes: number) => `data:image/jpeg;base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`

  it('rejects an over-long paste before reaching the model', async () => {
    mockTemplate('{}')
    await expect(firebaseParse('x'.repeat(MAX_PARSE_CHARS + 1))).rejects.toBeInstanceOf(CloudAIError)
    expect(getTemplateModel).not.toHaveBeenCalled()
  })

  it('rejects more photos than a scan allows, before reaching the model', async () => {
    mockTemplate('{"bottles":[]}')
    const many = Array.from({ length: MAX_SCAN_IMAGES + 1 }, () => jpeg(100))
    await expect(firebaseIdentifyBottles(many)).rejects.toBeInstanceOf(CloudAIError)
    expect(getTemplateModel).not.toHaveBeenCalled()
  })

  it('rejects a photo over the byte budget', async () => {
    mockTemplate('{"bottles":[]}')
    await expect(firebaseIdentifyBottles([jpeg(MAX_IMAGE_BYTES + 1024)])).rejects.toBeInstanceOf(
      CloudAIError,
    )
    expect(getTemplateModel).not.toHaveBeenCalled()
  })

  // Output ceilings used to be asserted here. They now live in each template's
  // frontmatter, on the server, where this client cannot raise them at all —
  // a stronger guarantee than the one this test used to make.
  it('never lets the client choose the model or its config', async () => {
    const generateContent = mockTemplate('{"recipes":[]}')
    await firebaseParse('Daiquiri').catch(() => {})
    const [, vars] = generateContent.mock.calls[0]
    expect(Object.keys(vars as object)).toEqual(['description', 'methods', 'glasses', 'tagVocab'])
  })
})

// The SDK puts the request URL in every error message, and that URL contains
// words this classifier used to match on — `templateGenerateContent` contains
// "rate". A 500 was reported to users as a rate limit because of it.
describe('friendlyError classification', () => {
  const URL_IN_MSG =
    'AI: Error fetching from https://firebasevertexai.googleapis.com/v1beta/projects/p/templates/t:templateGenerateContent:'

  const failWith = async (message: string) => {
    vi.mocked(getTemplateModel).mockRejectedValueOnce(new Error(message))
    return firebaseIdentifyBottles(['data:image/jpeg;base64,QUJD']).catch((e: Error) => e.message)
  }

  it('does not read "rate" out of the endpoint name', async () => {
    expect(await failWith(`${URL_IN_MSG} [500 ] Internal error encountered.`)).toMatch(
      /service had a problem/i,
    )
  })

  it('still recognises a real rate limit', async () => {
    expect(await failWith(`${URL_IN_MSG} [429 ] Quota exceeded.`)).toMatch(/rate-limited/i)
  })

  it('does not read "fetch" out of "Error fetching from"', async () => {
    expect(await failWith(`${URL_IN_MSG} [400 ] Bad request.`)).not.toMatch(/your connection/i)
  })

  it('still recognises a genuine network failure', async () => {
    expect(await failWith('Failed to fetch')).toMatch(/your connection/i)
  })
})
