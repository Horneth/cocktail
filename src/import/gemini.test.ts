import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GeminiError,
  dedupeBottles,
  geminiIdentifyBottles,
  mapGeminiRecipe,
  type GeminiRecipe,
} from './gemini'

const SAMPLE: GeminiRecipe = {
  name: 'Whiskey Sour',
  kind: 'cocktail',
  spirit: 'bourbon', // synonym -> whiskey
  method: 'Shake',
  glassware: 'Rocks',
  garnish: 'Orange peel',
  tags: ['Sour', '#classic', 'sour'], // mixed case, hash, duplicate
  ingredients: [
    { amount: 2, unit: 'oz', name: 'Bourbon' },
    { amount: 0.75, unit: 'oz', name: 'Lemon Juice' },
    { amount: 0.75, unit: 'oz', name: 'Rich Simple Syrup' },
    { amount: 1, unit: 'each', name: 'Egg White', optional: true },
    { amount: null, unit: 'each', name: 'Orange peel' },
  ],
  subRecipes: [
    {
      name: 'Rich Simple Syrup',
      ingredients: [
        { amount: 2, unit: 'parts', name: 'sugar' },
        { amount: 1, unit: 'part', name: 'water' },
      ],
    },
  ],
}

describe('mapGeminiRecipe', () => {
  const r = mapGeminiRecipe(SAMPLE, 'https://youtu.be/abcdefghijk')

  it('maps the main recipe fields', () => {
    expect(r.main.name).toBe('Whiskey Sour')
    expect(r.main.kind).toBe('cocktail')
    expect(r.main.method).toBe('Shake')
    expect(r.main.garnish).toBe('Orange peel')
  })

  it('infers the base spirit, mapping synonyms to our enum', () => {
    expect(r.main.spirit).toBe('whiskey')
  })

  it('normalizes tags (lowercase, strip #, dedupe)', () => {
    expect(r.main.tags).toEqual(['sour', 'classic'])
  })

  it('coerces free-text units to our Unit set', () => {
    const syrup = r.components[0]
    expect(syrup.ingredients.map((i) => i.unit)).toEqual(['part', 'part'])
    expect(syrup.measureBasis).toBe('parts')
  })

  it('carries optional and null (to-taste) amounts', () => {
    const egg = r.main.ingredients.find((i) => i.name === 'Egg White')
    const peel = r.main.ingredients.find((i) => i.name === 'Orange peel')
    expect(egg?.optional).toBe(true)
    expect(peel?.amount).toBeNull()
  })

  it('cross-links the syrup ingredient to the component', () => {
    const syrupIng = r.main.ingredients.find((i) => i.name === 'Rich Simple Syrup')
    expect(syrupIng?.subRecipeRef).toBe(r.components[0].tempId)
  })

  it('records provenance from the source URL', () => {
    expect(r.main.source?.type).toBe('youtube')
    expect(r.main.source?.videoId).toBe('abcdefghijk')
  })

  it('falls back to a default name and tolerates missing sub-recipes', () => {
    const bare = mapGeminiRecipe({ ingredients: [{ name: 'Gin', unit: 'oz', amount: 2 }] })
    expect(bare.main.name).toBe('Imported cocktail')
    expect(bare.components).toEqual([])
  })
})

describe('mapGeminiRecipe — mocktail', () => {
  it('accepts mocktail as a spirit', () => {
    const r = mapGeminiRecipe({
      name: 'No-Groni',
      kind: 'cocktail',
      spirit: 'mocktail',
      ingredients: [{ amount: 1, unit: 'oz', name: 'Seedlip Spice' }],
    })
    expect(r.main.spirit).toBe('mocktail')
  })

  it('keeps specific spirits (cachaça, mezcal) instead of collapsing them', () => {
    expect(mapGeminiRecipe({ spirit: 'cachaça', ingredients: [{ name: 'Cachaça', unit: 'oz' }] }).main.spirit).toBe('cachaça')
    expect(mapGeminiRecipe({ spirit: 'cachaca', ingredients: [{ name: 'x', unit: 'oz' }] }).main.spirit).toBe('cachaça')
    expect(mapGeminiRecipe({ spirit: 'mezcal', ingredients: [{ name: 'x', unit: 'oz' }] }).main.spirit).toBe('mezcal')
  })

  it('maps zero-proof synonyms (virgin, non-alcoholic) to mocktail', () => {
    expect(mapGeminiRecipe({ spirit: 'virgin', ingredients: [{ name: 'x', unit: 'oz' }] }).main.spirit).toBe('mocktail')
    expect(mapGeminiRecipe({ spirit: 'non-alcoholic', ingredients: [{ name: 'x', unit: 'oz' }] }).main.spirit).toBe('mocktail')
  })
})

describe('mapGeminiRecipe — standalone syrup', () => {
  const syrup: GeminiRecipe = {
    name: 'Orgeat',
    kind: 'component',
    ingredients: [
      { amount: 2, unit: 'parts', name: 'almond milk' },
      { amount: 1, unit: 'part', name: 'sugar' },
    ],
  }
  const r = mapGeminiRecipe(syrup)

  it('imports a syrup-only description as a parts component, not a cocktail', () => {
    expect(r.main.kind).toBe('component')
    expect(r.main.measureBasis).toBe('parts')
    expect(r.main.spirit).toBeUndefined()
  })
})

describe('dedupeBottles', () => {
  it('dedupes by normalized name and lets our categorizer win', () => {
    const out = dedupeBottles([
      { name: 'Woodford Reserve', category: 'bourbon' }, // categorizer -> whiskey
      { name: 'woodford reserve' }, // duplicate, dropped
      { name: 'Some Amaro' }, // categorizer -> liqueur
      { name: '' }, // dropped
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ name: 'Woodford Reserve', category: 'whiskey' })
    expect(out[1]).toEqual({ name: 'Some Amaro', category: 'liqueur' })
  })

  it('keeps the model category when the categorizer cannot classify', () => {
    expect(dedupeBottles([{ name: 'Mystery Bottle', category: 'gin' }])).toEqual([
      { name: 'Mystery Bottle', category: 'gin' },
    ])
  })
})

describe('geminiIdentifyBottles', () => {
  const IMG = 'data:image/jpeg;base64,QUJD'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch(payload: unknown, ok = true, status = 200) {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit): Promise<Response> =>
        ({
          ok,
          status,
          text: async () => '',
          json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }),
        }) as unknown as Response,
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('sends image inlineData parts and returns deduped bottles', async () => {
    const fetchMock = stubFetch({ bottles: [{ name: 'Tanqueray' }, { name: 'Tanqueray' }] })
    const out = await geminiIdentifyBottles([IMG], 'key')
    expect(out).toEqual([{ name: 'Tanqueray', category: 'gin' }])

    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(init.body as string)
    const parts = body.contents[0].parts
    expect(
      parts.some(
        (p: { inlineData?: { mimeType: string; data: string } }) =>
          p.inlineData?.mimeType === 'image/jpeg' && p.inlineData?.data === 'QUJD',
      ),
    ).toBe(true)
  })

  it('throws GeminiError with no api key or no images', async () => {
    await expect(geminiIdentifyBottles([IMG], '')).rejects.toBeInstanceOf(GeminiError)
    await expect(geminiIdentifyBottles([], 'key')).rejects.toBeInstanceOf(GeminiError)
  })

  it('surfaces a rate-limit error', async () => {
    stubFetch({}, false, 429)
    await expect(geminiIdentifyBottles([IMG], 'key')).rejects.toThrow(/rate limit/)
  })
})
