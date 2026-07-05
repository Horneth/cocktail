import { coerceUnit } from '../domain/units'
import type { RecipeKind, SpiritCategory } from '../db/schema'
import type { IngredientDraft, RecipeDraft, StructuredImport } from './types'

// Optional cloud parsing via the Gemini API. The user supplies their own API
// key (stored only in their browser); the call goes straight from the browser
// to Google. No key ever lives in this repo. The heuristic parser remains the
// always-available fallback.

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

// Shape we ask Gemini to return (a subset of OpenAPI schema, per Gemini's
// responseSchema support). We wire cross-links ourselves afterwards by name.
const INGREDIENT_SCHEMA = {
  type: 'object',
  properties: {
    amount: { type: 'number', nullable: true },
    unit: { type: 'string' },
    name: { type: 'string' },
    optional: { type: 'boolean' },
    note: { type: 'string' },
  },
  required: ['name', 'unit'],
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    kind: { type: 'string' },
    method: { type: 'string' },
    glassware: { type: 'string' },
    garnish: { type: 'string' },
    instructions: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    spirit: { type: 'string' },
    ingredients: { type: 'array', items: INGREDIENT_SCHEMA },
    subRecipes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          ingredients: { type: 'array', items: INGREDIENT_SCHEMA },
        },
        required: ['name', 'ingredients'],
      },
    },
  },
  required: ['name', 'ingredients'],
}

const PROMPT = `You extract a drink recipe from a video description (often from the Anders Erickson channel).
Return JSON matching the schema. Rules:
- "name": the drink's name only (no channel or video title fluff).
- "kind": "cocktail" for a mixed drink, OR "component" if the ENTIRE description is just a syrup/cordial/orgeat/infusion/mix recipe with no cocktail build.
- "ingredients": each line of the main build. Keep the amount as a number in the unit as written (oz, ml, cl, dash, barspoon, tsp, tbsp, part). Use amount null for "to taste", garnishes, or "top with" items. Strip any parenthetical unit conversion like "(30 ml)" from the name.
- "subRecipes": any syrups/cordials/orgeat/etc. described as their OWN ingredient block. Use unit "part" for ratio recipes ("1 part sugar"). Give each the EXACT name used in the main ingredient list so they can be linked. Always split these out rather than leaving them as one ingredient.
- "spirit": the primary base spirit as a short lowercase word. Use the SPECIFIC spirit the recipe names — e.g. gin, vodka, rum, cachaça, whiskey, tequila, mezcal, brandy, cognac, pisco, sake, wine, liqueur. Do NOT collapse a specific spirit into a broader one (a Caipirinha is "cachaça", not "rum"). Only normalize spelling/family: bourbon/rye/scotch/whisky -> whiskey. Use "mocktail" for any non-alcoholic / zero-proof / "virgin" drink. Omit spirit for a component/syrup.
- "tags": 2 to 4 short lowercase tags describing style and flavor. Choose from ideas like: sour, spirit-forward, stirred, shaken, built, tiki, citrusy, refreshing, bitter, herbal, creamy, fruity, boozy, low-abv, zero-proof, mocktail, hot, classic, dry. No "#".
- Ignore non-recipe text: links, chapters/timestamps, gear lists, socials, sponsorships.
- If a value is unknown, omit it. Do not invent ingredients.`

interface GeminiIngredient {
  amount?: number | null
  unit?: string
  name?: string
  optional?: boolean
  note?: string
}
export interface GeminiRecipe {
  name?: string
  kind?: string
  method?: string
  glassware?: string
  garnish?: string
  instructions?: string
  tags?: string[]
  spirit?: string
  ingredients?: GeminiIngredient[]
  subRecipes?: { name?: string; ingredients?: GeminiIngredient[] }[]
}

let counter = 0
const tempId = (p: string) => `${p}-${(counter += 1)}`

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(semi-?rich|rich|fresh|homemade|cold|hot|pure)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Only spelling/family normalization — specific spirits (cachaça, mezcal,
// pisco, cognac, …) are kept as-is so they get their own category.
const SPIRIT_SYNONYMS: Record<string, SpiritCategory> = {
  whisky: 'whiskey', scotch: 'whiskey', bourbon: 'whiskey', rye: 'whiskey',
  rhum: 'rum', cachaca: 'cachaça',
  // zero-proof
  virgin: 'mocktail', 'non-alcoholic': 'mocktail', nonalcoholic: 'mocktail',
  'zero-proof': 'mocktail', zeroproof: 'mocktail', na: 'mocktail', seedlip: 'mocktail',
}

function coerceSpirit(raw: string | undefined): SpiritCategory | undefined {
  if (!raw) return undefined
  const w = raw.trim().toLowerCase()
  if (!w || w === 'none') return undefined
  return SPIRIT_SYNONYMS[w] ?? w
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const v = t.trim().toLowerCase().replace(/^#/, '')
    if (v && !seen.has(v)) {
      seen.add(v)
      out.push(v)
    }
  }
  return out.slice(0, 6)
}

function toDraftIngredient(g: GeminiIngredient): IngredientDraft {
  const ing: IngredientDraft = {
    name: (g.name ?? '').trim(),
    amount: g.amount ?? null,
    unit: coerceUnit(g.unit),
  }
  if (g.optional) ing.optional = true
  if (g.note) ing.note = g.note
  return ing
}

/** Pure: map a Gemini JSON object into our StructuredImport, wiring cross-links by name. */
export function mapGeminiRecipe(r: GeminiRecipe, sourceUrl?: string): StructuredImport {
  counter = 0
  const components: RecipeDraft[] = (r.subRecipes ?? [])
    .filter((c) => c.name && (c.ingredients?.length ?? 0) > 0)
    .map((c) => {
      const ingredients = (c.ingredients ?? []).map(toDraftIngredient).filter((i) => i.name)
      return {
        tempId: tempId('comp'),
        kind: 'component' as const,
        name: (c.name ?? '').trim(),
        ingredients,
        measureBasis: ingredients.some((i) => i.unit === 'part') ? ('parts' as const) : ('absolute' as const),
        tags: [],
      }
    })

  const compByName = new Map(components.map((c) => [normalize(c.name), c]))
  const ingredients = (r.ingredients ?? []).map(toDraftIngredient).filter((i) => i.name)
  for (const ing of ingredients) {
    const key = normalize(ing.name)
    let match = compByName.get(key)
    if (!match) {
      for (const [cname, c] of compByName) {
        if (cname && (key.includes(cname) || cname.includes(key))) {
          match = c
          break
        }
      }
    }
    if (match) ing.subRecipeRef = match.tempId
  }

  const videoId = sourceUrl?.match(/(?:v=|youtu\.be\/)([\w-]{11})/)?.[1]
  const kind: RecipeKind = r.kind === 'component' ? 'component' : 'cocktail'
  const main: RecipeDraft = {
    tempId: tempId('main'),
    kind,
    name: (r.name ?? '').trim() || (kind === 'component' ? 'Imported syrup' : 'Imported cocktail'),
    ingredients,
    // a component described in "1 part" ratios is a parts recipe
    measureBasis:
      kind === 'component' && ingredients.some((i) => i.unit === 'part') ? 'parts' : 'absolute',
    method: r.method,
    glassware: r.glassware,
    garnish: r.garnish,
    instructions: r.instructions,
    tags: normalizeTags(r.tags),
    spirit: kind === 'component' ? undefined : coerceSpirit(r.spirit),
    source: {
      type: sourceUrl ? 'youtube' : 'web',
      ...(sourceUrl ? { url: sourceUrl, videoId } : {}),
      channel: 'Anders Erickson',
    },
  }

  return { main, components }
}

export class GeminiError extends Error {}

/** Call Gemini and return a StructuredImport. Throws GeminiError on failure. */
export async function geminiParse(
  text: string,
  apiKey: string,
  model = DEFAULT_GEMINI_MODEL,
): Promise<StructuredImport> {
  if (!apiKey.trim()) throw new GeminiError('No API key set.')

  let res: Response
  try {
    res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${PROMPT}\n\nDESCRIPTION:\n${text}` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
        },
      }),
    })
  } catch {
    // network / CORS failure
    throw new GeminiError(
      'Could not reach Gemini from the browser (network or CORS). Use Basic parse, or set up a proxy.',
    )
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 400 || res.status === 403) {
      throw new GeminiError('Gemini rejected the request — check that your API key is valid and enabled.')
    }
    if (res.status === 429) throw new GeminiError('Gemini rate limit reached — try again in a moment.')
    throw new GeminiError(`Gemini error ${res.status}. ${detail.slice(0, 140)}`)
  }

  const data = await res.json()
  const jsonText: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!jsonText) throw new GeminiError('Gemini returned no content.')

  let parsed: GeminiRecipe
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new GeminiError('Gemini returned malformed JSON.')
  }

  const url = text.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/i)?.[0]
  const result = mapGeminiRecipe(parsed, url)
  if (!result.main.ingredients.length) throw new GeminiError('Gemini found no ingredients.')
  return result
}
