import { coerceUnit } from '../domain/units'
import { normalizeComponentName } from '../domain/textNormalize'
import { normIngredient } from '../domain/availability'
import { categoryForName } from '../domain/spiritCategory'
import type { RecipeKind, SpiritCategory } from '../db/schema'
import type { IngredientDraft, RecipeDraft, StructuredImport } from './types'
import { splitDataUrl } from './image'

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

// One drink (cocktail or standalone syrup) plus its own sub-recipes.
const RECIPE_SCHEMA = {
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

// A single video description often contains SEVERAL cocktails, so we ask for a
// list. Each entry is a full recipe with its own sub-recipes.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    recipes: { type: 'array', items: RECIPE_SCHEMA },
  },
  required: ['recipes'],
}

const PROMPT = `You extract EVERY drink recipe from a pasted recipe or video description. A single description frequently contains SEVERAL cocktails — return all of them.
Return JSON matching the schema: a "recipes" array with one entry per drink, in the order they appear. Rules per recipe:
- "name": the drink's name only (no channel or video title fluff).
- "kind": "cocktail" for a mixed drink, OR "component" if the entry is purely a syrup/cordial/orgeat/infusion/mix recipe with no cocktail build. Prefer attaching syrups as "subRecipes" of the cocktail that uses them; only emit a top-level "component" recipe when a syrup stands entirely on its own.
- "ingredients": each line of that drink's build. Keep the amount as a number in the unit as written (oz, ml, cl, dash, barspoon, tsp, tbsp, part). Use amount null for "to taste", garnishes, or "top with" items. Strip any parenthetical unit conversion like "(30 ml)" from the name.
- "subRecipes": any syrups/cordials/orgeat/etc. that drink relies on, described as their OWN ingredient block. Use unit "part" for ratio recipes ("1 part sugar"). Give each the EXACT name used in that drink's ingredient list so they can be linked. If two cocktails share the same syrup, include it under each. Always split these out rather than leaving them as one ingredient.
- "spirit": the primary base spirit as a short lowercase word. Use the SPECIFIC spirit the recipe names — e.g. gin, vodka, rum, cachaça, whiskey, tequila, mezcal, brandy, cognac, pisco, sake, wine, liqueur. Do NOT collapse a specific spirit into a broader one (a Caipirinha is "cachaça", not "rum"). Only normalize spelling/family: bourbon/rye/scotch/whisky -> whiskey. Use "mocktail" for any non-alcoholic / zero-proof / "virgin" drink. Omit spirit for a component/syrup.
- "tags": 2 to 4 short lowercase tags describing style and flavor. Choose from ideas like: sour, spirit-forward, stirred, shaken, built, tiki, citrusy, refreshing, bitter, herbal, creamy, fruity, boozy, low-abv, zero-proof, mocktail, hot, classic, dry. No "#".
- Ignore non-recipe text: links, chapters/timestamps, gear lists, socials, sponsorships.
- If a value is unknown, omit it. Do not invent ingredients. If the description has exactly one drink, return a one-element "recipes" array.`

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

  const compByName = new Map(components.map((c) => [normalizeComponentName(c.name), c]))
  const ingredients = (r.ingredients ?? []).map(toDraftIngredient).filter((i) => i.name)
  for (const ing of ingredients) {
    const key = normalizeComponentName(ing.name)
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
    },
  }

  return { main, components }
}

export class GeminiError extends Error {}

// mapGeminiRecipe resets its tempId counter per call, so ids collide across the
// recipes of one batch. Re-namespace each import's tempIds (and the matching
// subRecipeRefs) so a multi-recipe preview can key everything uniquely.
function namespaceTempIds(imp: StructuredImport, i: number): StructuredImport {
  const rename = (id: string) => `r${i}.${id}`
  return {
    main: {
      ...imp.main,
      tempId: rename(imp.main.tempId),
      ingredients: imp.main.ingredients.map((ing) =>
        ing.subRecipeRef ? { ...ing, subRecipeRef: rename(ing.subRecipeRef) } : ing,
      ),
    },
    components: imp.components.map((c) => ({ ...c, tempId: rename(c.tempId) })),
  }
}

/**
 * Call Gemini and return one StructuredImport per drink found in the text.
 * A description commonly holds several cocktails. Throws GeminiError on failure.
 */
export async function geminiParse(
  text: string,
  apiKey: string,
  model = DEFAULT_GEMINI_MODEL,
): Promise<StructuredImport[]> {
  if (!apiKey.trim()) throw new GeminiError('No API key set.')

  let res: Response
  // Abort a hung request so the Import screen can never freeze on the spinner
  // forever — surface a retryable error instead.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${PROMPT}\n\nDESCRIPTION:\n${text}` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
        },
      }),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new GeminiError('Gemini took too long to respond — try again, or use Basic parse.')
    }
    // network / CORS failure
    throw new GeminiError(
      'Could not reach Gemini from the browser (network or CORS). Use Basic parse, or set up a proxy.',
    )
  } finally {
    clearTimeout(timer)
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

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new GeminiError('Gemini returned malformed JSON.')
  }

  // Accept the multi-recipe shape ({ recipes: [...] }) or a bare single recipe.
  const raw = parsed as { recipes?: GeminiRecipe[] } & GeminiRecipe
  const list: GeminiRecipe[] = Array.isArray(raw?.recipes)
    ? raw.recipes
    : raw?.ingredients
      ? [raw]
      : []

  const url = text.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/i)?.[0]
  const results = list
    .map((r, i) => namespaceTempIds(mapGeminiRecipe(r, url), i))
    .filter((r) => r.main.ingredients.length > 0)

  if (!results.length) throw new GeminiError('Gemini found no recipes.')
  return results
}

// ── Photo → bar (Gemini vision) ────────────────────────────────────────────

export interface IdentifiedBottle {
  name: string
  category?: string
}

const BOTTLES_SCHEMA = {
  type: 'object',
  properties: {
    bottles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          category: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  required: ['bottles'],
}

const VISION_PROMPT = `You are looking at photo(s) of a home bar or liquor shelf. List every distinct liquor, spirit, wine, or liqueur BOTTLE you can identify.
- "name": the bottle's brand/label as printed (e.g. "Woodford Reserve", "Tanqueray", "Campari"). If the brand is unreadable but the type is clear, use the type (e.g. "London dry gin").
- "category": a short lowercase base category — one of gin, vodka, rum, whiskey, tequila, mezcal, brandy, cognac, cachaça, pisco, wine, liqueur. Omit if unsure.
- One entry per distinct bottle. Ignore glassware, mixers, garnishes and non-bottle items. Do not invent bottles you cannot clearly see.`

type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } }

/** Pure: clean + dedupe Gemini's bottle list, letting our categorizer win on category. */
export function dedupeBottles(raw: { name?: string; category?: string }[]): IdentifiedBottle[] {
  const seen = new Set<string>()
  const out: IdentifiedBottle[] = []
  for (const b of raw) {
    const name = (b.name ?? '').trim()
    const key = normIngredient(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const fromModel = b.category?.trim().toLowerCase() || undefined
    out.push({ name, category: categoryForName(name) ?? fromModel })
  }
  return out
}

/**
 * Identify the bottles visible in one or more photos (data URLs). Returns a
 * deduped list the user can review before adding to a bar. Throws GeminiError.
 */
export async function geminiIdentifyBottles(
  images: string[],
  apiKey: string,
  model = DEFAULT_GEMINI_MODEL,
): Promise<IdentifiedBottle[]> {
  if (!apiKey.trim()) throw new GeminiError('No API key set.')
  if (!images.length) throw new GeminiError('No photos to scan.')

  const parts: ContentPart[] = [{ text: VISION_PROMPT }]
  for (const dataUrl of images) {
    const split = splitDataUrl(dataUrl)
    if (!split) throw new GeminiError('One of the photos was in an unsupported format.')
    parts.push({ inlineData: { mimeType: split.mimeType, data: split.data } })
  }

  let res: Response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: BOTTLES_SCHEMA,
          temperature: 0.1,
        },
      }),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new GeminiError('Gemini took too long to respond — try again.')
    }
    throw new GeminiError(
      'Could not reach Gemini from the browser (network or CORS). Try again, or add bottles by hand.',
    )
  } finally {
    clearTimeout(timer)
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

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new GeminiError('Gemini returned malformed JSON.')
  }

  const raw = (parsed as { bottles?: { name?: string; category?: string }[] })?.bottles ?? []
  return dedupeBottles(raw)
}
