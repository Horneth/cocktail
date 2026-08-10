import { describe, expect, it } from 'vitest'
import {
  INGREDIENT_SCHEMA,
  RESPONSE_SCHEMA,
  dedupeBottles,
  finishDupeJudgement,
  finishParse,
  mapAiRecipe,
  namespaceTempIds,
  toJsonSchema,
  type AiRecipe,
  type DupeQuery,
} from './aiShared'

describe('toJsonSchema', () => {
  it('turns a nullable field into a union type, leaving everything else identity', () => {
    const js = toJsonSchema(INGREDIENT_SCHEMA)
    const props = js.properties as Record<string, { type: unknown }>
    // { type: 'number', nullable: true } -> { type: ['number', 'null'] }
    expect(props.amount.type).toEqual(['number', 'null'])
    // non-nullable fields keep a plain string type
    expect(props.name.type).toBe('string')
    expect(js.required).toEqual(['name', 'unit'])
    expect(js.type).toBe('object')
  })

  it('recurses into array items and nested objects', () => {
    const js = toJsonSchema(RESPONSE_SCHEMA)
    const recipes = (js.properties as Record<string, { items?: { type?: unknown } }>).recipes
    expect(recipes.items?.type).toBe('object')
    // a deep nullable (recipes[].ingredients[].amount) is still converted
    const recipeItems = recipes.items as { properties: Record<string, { items?: { properties?: Record<string, { type?: unknown }> } }> }
    const ingItems = recipeItems.properties.ingredients.items
    expect(ingItems?.properties?.amount.type).toEqual(['number', 'null'])
  })

  it('does not mutate the source schema', () => {
    const before = JSON.stringify(INGREDIENT_SCHEMA)
    toJsonSchema(INGREDIENT_SCHEMA)
    expect(JSON.stringify(INGREDIENT_SCHEMA)).toBe(before)
  })
})

// These cover the mapper that every AI backend funnels through — they used to
// live in gemini.test.ts, against the BYO-key transport that has since been
// retired. The logic is the transport-agnostic part, so it belongs here.
const SAMPLE: AiRecipe = {
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

describe('mapAiRecipe', () => {
  const r = mapAiRecipe(SAMPLE, 'https://youtu.be/abcdefghijk')

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
    const bare = mapAiRecipe({ ingredients: [{ name: 'Gin', unit: 'oz', amount: 2 }] })
    expect(bare.main.name).toBe('Imported cocktail')
    expect(bare.components).toEqual([])
  })
})

describe('mapAiRecipe — mocktail', () => {
  it('accepts mocktail as a spirit', () => {
    const r = mapAiRecipe({
      name: 'No-Groni',
      kind: 'cocktail',
      spirit: 'mocktail',
      ingredients: [{ amount: 1, unit: 'oz', name: 'Seedlip Spice' }],
    })
    expect(r.main.spirit).toBe('mocktail')
  })

  it('keeps specific spirits (cachaça, mezcal) instead of collapsing them', () => {
    expect(mapAiRecipe({ spirit: 'cachaça', ingredients: [{ name: 'Cachaça', unit: 'oz' }] }).main.spirit).toBe('cachaça')
    expect(mapAiRecipe({ spirit: 'cachaca', ingredients: [{ name: 'x', unit: 'oz' }] }).main.spirit).toBe('cachaça')
    expect(mapAiRecipe({ spirit: 'mezcal', ingredients: [{ name: 'x', unit: 'oz' }] }).main.spirit).toBe('mezcal')
  })

  it('maps zero-proof synonyms (virgin, non-alcoholic) to mocktail', () => {
    expect(mapAiRecipe({ spirit: 'virgin', ingredients: [{ name: 'x', unit: 'oz' }] }).main.spirit).toBe('mocktail')
    expect(mapAiRecipe({ spirit: 'non-alcoholic', ingredients: [{ name: 'x', unit: 'oz' }] }).main.spirit).toBe('mocktail')
  })
})

describe('mapAiRecipe — standalone syrup', () => {
  const syrup: AiRecipe = {
    name: 'Orgeat',
    kind: 'component',
    ingredients: [
      { amount: 2, unit: 'parts', name: 'almond milk' },
      { amount: 1, unit: 'part', name: 'sugar' },
    ],
  }
  const r = mapAiRecipe(syrup)

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

describe('namespaceTempIds', () => {
  it('prefixes tempIds and rewrites matching subRecipeRefs per batch index', () => {
    const imp = mapAiRecipe({
      name: 'Mai Tai',
      ingredients: [{ name: 'Orgeat', unit: 'oz', amount: 0.5 }],
      subRecipes: [{ name: 'Orgeat', ingredients: [{ name: 'almond', unit: 'part', amount: 1 }] }],
    })
    const ref = imp.main.ingredients[0].subRecipeRef
    expect(ref).toBe(imp.components[0].tempId) // linked before namespacing

    const ns = namespaceTempIds(imp, 2)
    expect(ns.main.tempId).toMatch(/^r2\./)
    expect(ns.components[0].tempId).toMatch(/^r2\./)
    // the ingredient's ref is rewritten to still point at the renamed component
    expect(ns.main.ingredients[0].subRecipeRef).toBe(ns.components[0].tempId)
  })
})

describe('finishParse', () => {
  const RECIPE: AiRecipe = {
    name: 'Daiquiri',
    ingredients: [
      { name: 'White rum', unit: 'oz', amount: 2 },
      { name: 'Lime juice', unit: 'oz', amount: 0.75 },
    ],
  }

  it('accepts the multi-recipe { recipes: [...] } shape', () => {
    const out = finishParse({ recipes: [RECIPE, RECIPE] }, 'some text')
    expect(out).toHaveLength(2)
    // tempIds namespaced distinctly across the batch
    expect(out[0].main.tempId).not.toBe(out[1].main.tempId)
    expect(out[0].main.name).toBe('Daiquiri')
  })

  it('accepts a bare single recipe (has ingredients, no recipes array)', () => {
    const out = finishParse(RECIPE, '')
    expect(out).toHaveLength(1)
    expect(out[0].main.ingredients).toHaveLength(2)
  })

  it('drops recipes with no usable ingredients and returns [] for junk', () => {
    expect(finishParse({ recipes: [{ name: 'Empty', ingredients: [] }] }, '')).toEqual([])
    expect(finishParse({ nonsense: true }, '')).toEqual([])
    expect(finishParse(null, '')).toEqual([])
  })

  it('records a YouTube source URL found in the text', () => {
    const out = finishParse({ recipes: [RECIPE] }, 'Recipe from https://youtu.be/abcdefghijk enjoy')
    expect(out[0].main.source?.type).toBe('youtube')
    expect(out[0].main.source?.videoId).toBe('abcdefghijk')
  })
})

describe('mapAiRecipe — vocabulary and inferred fields', () => {
  const DAIQUIRI: AiRecipe = {
    name: 'Daiquiri',
    spirit: 'rum',
    method: 'shake',
    glassware: 'coupe',
    garnish: 'Lime wheel',
    ingredients: [{ name: 'White rum', unit: 'oz', amount: 2 }],
  }

  it('snaps method and glass onto the shared vocabulary casing', () => {
    const { main } = mapAiRecipe(DAIQUIRI)
    expect(main.method).toBe('Shake')
    expect(main.glassware).toBe('Coupe')
  })

  it('marks a field as guessed when its value is nowhere in the source text', () => {
    const { guessed } = mapAiRecipe(DAIQUIRI, undefined, 'Daiquiri\n2 oz white rum')
    expect(guessed).toEqual(expect.arrayContaining(['method', 'glassware', 'garnish']))
  })

  it('un-marks a field the model claimed to guess but actually read', () => {
    const { guessed } = mapAiRecipe(
      { ...DAIQUIRI, guessed: ['method', 'glassware'] },
      undefined,
      'Daiquiri\n2 oz rum\nShake and strain into a coupe.',
    )
    expect(guessed ?? []).not.toContain('method')
    expect(guessed ?? []).not.toContain('glassware')
  })

  it('trusts the model on tags and kind, which are never literal quotes', () => {
    const withClaim = mapAiRecipe({ ...DAIQUIRI, guessed: ['tags', 'kind'] }, undefined, 'anything')
    expect(withClaim.guessed).toEqual(expect.arrayContaining(['tags', 'kind']))
    const without = mapAiRecipe(DAIQUIRI, undefined, 'anything')
    expect(without.guessed ?? []).not.toContain('tags')
  })

  it('omits guessed entirely when everything came from the text', () => {
    const source = 'Daiquiri\n2 oz white rum\nShake into a Coupe with a Lime wheel, rum base'
    expect(mapAiRecipe(DAIQUIRI, undefined, source).guessed).toBeUndefined()
  })

  it('keeps a serve off a sub-recipe, which is an ingredient and not a drink', () => {
    const { main } = mapAiRecipe({
      name: 'Simple Syrup',
      kind: 'component',
      glassware: 'Coupe',
      garnish: 'Mint',
      spirit: 'rum',
      ingredients: [{ name: 'Sugar', unit: 'part', amount: 1 }],
    })
    expect(main.glassware).toBeUndefined()
    expect(main.garnish).toBeUndefined()
    expect(main.spirit).toBeUndefined()
  })

  it('dedupes and caps aka, and drops it when empty', () => {
    const { aka } = mapAiRecipe({ ...DAIQUIRI, aka: [' Rum Sour ', 'rum sour', 'Bacardi'] })
    expect(aka).toEqual(['Rum Sour', 'Bacardi'])
    expect(mapAiRecipe(DAIQUIRI).aka).toBeUndefined()
  })

  it('carries guessed and aka through tempId namespacing', () => {
    const imp = mapAiRecipe({ ...DAIQUIRI, aka: ['Rum Sour'] }, undefined, 'Daiquiri')
    const out = namespaceTempIds(imp, 3)
    expect(out.aka).toEqual(['Rum Sour'])
    expect(out.guessed).toEqual(imp.guessed)
  })
})

describe('finishDupeJudgement', () => {
  const QUERIES: DupeQuery[] = [
    { index: 0, name: 'Rum Sour', aka: ['Daiquiri'], candidates: ['Daiquiri'] },
    { index: 1, name: 'Oaxacan Old Fashioned', aka: [], candidates: ['Old Fashioned'] },
  ]

  it('keeps same/variation verdicts and echoes the candidate verbatim', () => {
    const out = finishDupeJudgement(
      {
        verdicts: [
          { index: 0, relation: 'same', match: 'daiquiri', reason: 'same drink, other name' },
          { index: 1, relation: 'variation', match: 'Old Fashioned' },
        ],
      },
      QUERIES,
    )
    expect(out).toEqual([
      { index: 0, relation: 'same', match: 'Daiquiri', reason: 'same drink, other name' },
      { index: 1, relation: 'variation', match: 'Old Fashioned' },
    ])
  })

  it('drops "different", unknown relations, and unasked indexes', () => {
    const out = finishDupeJudgement(
      {
        verdicts: [
          { index: 0, relation: 'different', match: 'Daiquiri' },
          { index: 1, relation: 'maybe?', match: 'Old Fashioned' },
          { index: 9, relation: 'same', match: 'Daiquiri' },
        ],
      },
      QUERIES,
    )
    expect(out).toEqual([])
  })

  it('drops a match the model invented rather than picked from the candidates', () => {
    // Otherwise the preview would claim a duplicate against a recipe the user
    // does not own, with a link that goes nowhere.
    const out = finishDupeJudgement(
      { verdicts: [{ index: 0, relation: 'same', match: 'Hemingway Daiquiri' }] },
      QUERIES,
    )
    expect(out).toEqual([])
  })

  it('keeps only the first verdict for a repeated index', () => {
    const out = finishDupeJudgement(
      {
        verdicts: [
          { index: 0, relation: 'same', match: 'Daiquiri' },
          { index: 0, relation: 'variation', match: 'Daiquiri' },
        ],
      },
      QUERIES,
    )
    expect(out).toHaveLength(1)
    expect(out[0].relation).toBe('same')
  })

  it('returns [] for junk instead of throwing', () => {
    expect(finishDupeJudgement(null, QUERIES)).toEqual([])
    expect(finishDupeJudgement({ verdicts: 'nope' }, QUERIES)).toEqual([])
    expect(finishDupeJudgement({}, QUERIES)).toEqual([])
  })
})
