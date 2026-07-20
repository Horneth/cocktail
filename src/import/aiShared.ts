import { coerceUnit } from '../domain/units'
import { normalizeComponentName } from '../domain/textNormalize'
import { normIngredient } from '../domain/availability'
import { categoryForName } from '../domain/spiritCategory'
import type { RecipeKind, SpiritCategory } from '../db/schema'
import type { IngredientDraft, RecipeDraft, StructuredImport } from './types'

// Transport-agnostic AI core. Everything here is pure and shared by every AI
// backend (cloud Gemini today, on-device WebLLM/transformers.js next): the
// structured-output schemas, the prompts, and the mappers that turn a model's
// raw JSON into our StructuredImport. A backend only has to produce the raw
// shapes below (`AiRecipe` / `{ bottles }`); all normalization lives here.

// ── Structured-output schemas ──────────────────────────────────────────────
// An OpenAPI subset (what Gemini's responseSchema accepts). `toJsonSchema()`
// converts it to plain JSON Schema for engines that want that (e.g. WebLLM).
export interface OpenApiSchema {
  type?: string
  nullable?: boolean
  properties?: Record<string, OpenApiSchema>
  items?: OpenApiSchema
  required?: string[]
}

// Shape we ask a model to return per ingredient. We wire cross-links ourselves
// afterwards by name.
export const INGREDIENT_SCHEMA: OpenApiSchema = {
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
export const RECIPE_SCHEMA: OpenApiSchema = {
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
export const RESPONSE_SCHEMA: OpenApiSchema = {
  type: 'object',
  properties: {
    recipes: { type: 'array', items: RECIPE_SCHEMA },
  },
  required: ['recipes'],
}

export const BOTTLES_SCHEMA: OpenApiSchema = {
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

/**
 * Convert our OpenAPI-subset schema into plain JSON Schema. Nearly identity —
 * the only real transform is `{ type, nullable: true }` → `{ type: [t, 'null'] }`
 * — for engines (e.g. WebLLM's grammar mode) that want JSON Schema, not Gemini's
 * responseSchema dialect. Pure and recursive.
 */
export function toJsonSchema(schema: OpenApiSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (schema.type !== undefined) {
    out.type = schema.nullable ? [schema.type, 'null'] : schema.type
  }
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toJsonSchema(v)]),
    )
  }
  if (schema.items) out.items = toJsonSchema(schema.items)
  if (schema.required) out.required = [...schema.required]
  return out
}

// ── Prompts ────────────────────────────────────────────────────────────────
export const PROMPT = `You extract EVERY drink recipe from a pasted recipe or video description. A single description frequently contains SEVERAL cocktails — return all of them.
Return JSON matching the schema: a "recipes" array with one entry per drink, in the order they appear. Rules per recipe:
- "name": the drink's name only (no channel or video title fluff).
- "kind": "cocktail" for a mixed drink, OR "component" if the entry is purely a syrup/cordial/orgeat/infusion/mix recipe with no cocktail build. Prefer attaching syrups as "subRecipes" of the cocktail that uses them; only emit a top-level "component" recipe when a syrup stands entirely on its own.
- "ingredients": each line of that drink's build. Keep the amount as a number in the unit as written (oz, ml, cl, dash, barspoon, tsp, tbsp, part). Use amount null for "to taste", garnishes, or "top with" items. Strip any parenthetical unit conversion like "(30 ml)" from the name.
- "subRecipes": any syrups/cordials/orgeat/etc. that drink relies on, described as their OWN ingredient block. Use unit "part" for ratio recipes ("1 part sugar"). Give each the EXACT name used in that drink's ingredient list so they can be linked. If two cocktails share the same syrup, include it under each. Always split these out rather than leaving them as one ingredient.
- "spirit": the primary base spirit as a short lowercase word. Use the SPECIFIC spirit the recipe names — e.g. gin, vodka, rum, cachaça, whiskey, tequila, mezcal, brandy, cognac, pisco, sake, wine, liqueur. Do NOT collapse a specific spirit into a broader one (a Caipirinha is "cachaça", not "rum"). Only normalize spelling/family: bourbon/rye/scotch/whisky -> whiskey. Use "mocktail" for any non-alcoholic / zero-proof / "virgin" drink. Omit spirit for a component/syrup.
- "tags": 2 to 4 short lowercase tags describing style and flavor. Choose from ideas like: sour, spirit-forward, stirred, shaken, built, tiki, citrusy, refreshing, bitter, herbal, creamy, fruity, boozy, low-abv, zero-proof, mocktail, hot, classic, dry. No "#".
- Ignore non-recipe text: links, chapters/timestamps, gear lists, socials, sponsorships.
- If a value is unknown, omit it. Do not invent ingredients. If the description has exactly one drink, return a one-element "recipes" array.`

export const VISION_PROMPT = `You are looking at photo(s) of a home bar or liquor shelf. List every distinct liquor, spirit, wine, or liqueur BOTTLE you can identify.
- "name": the bottle's brand/label as printed (e.g. "Woodford Reserve", "Tanqueray", "Campari"). If the brand is unreadable but the type is clear, use the type (e.g. "London dry gin").
- "category": a short lowercase base category — one of gin, vodka, rum, whiskey, tequila, mezcal, brandy, cognac, cachaça, pisco, wine, liqueur. Omit if unsure.
- One entry per distinct bottle. Ignore glassware, mixers, garnishes and non-bottle items. Do not invent bottles you cannot clearly see.`

// ── Raw model output types ─────────────────────────────────────────────────
export interface AiIngredient {
  amount?: number | null
  unit?: string
  name?: string
  optional?: boolean
  note?: string
}
export interface AiRecipe {
  name?: string
  kind?: string
  method?: string
  glassware?: string
  garnish?: string
  instructions?: string
  tags?: string[]
  spirit?: string
  ingredients?: AiIngredient[]
  subRecipes?: { name?: string; ingredients?: AiIngredient[] }[]
}

export interface IdentifiedBottle {
  name: string
  category?: string
}

// ── Mappers (pure) ─────────────────────────────────────────────────────────
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

function toDraftIngredient(g: AiIngredient): IngredientDraft {
  const ing: IngredientDraft = {
    name: (g.name ?? '').trim(),
    amount: g.amount ?? null,
    unit: coerceUnit(g.unit),
  }
  if (g.optional) ing.optional = true
  if (g.note) ing.note = g.note
  return ing
}

/** Pure: map a raw AI recipe JSON object into our StructuredImport, wiring cross-links by name. */
export function mapAiRecipe(r: AiRecipe, sourceUrl?: string): StructuredImport {
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

// mapAiRecipe resets its tempId counter per call, so ids collide across the
// recipes of one batch. Re-namespace each import's tempIds (and the matching
// subRecipeRefs) so a multi-recipe preview can key everything uniquely.
export function namespaceTempIds(imp: StructuredImport, i: number): StructuredImport {
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
 * Turn a model's parsed JSON into one StructuredImport per drink. Accepts the
 * multi-recipe shape (`{ recipes: [...] }`) or a bare single recipe, namespaces
 * tempIds across the batch, and drops entries with no main ingredients. Returns
 * an empty array if nothing usable was found — the caller decides how to surface
 * that (each backend throws its own error type). `sourceText` is scanned for a
 * YouTube URL to record provenance.
 */
export function finishParse(parsed: unknown, sourceText: string): StructuredImport[] {
  const raw = parsed as { recipes?: AiRecipe[] } & AiRecipe
  const list: AiRecipe[] = Array.isArray(raw?.recipes)
    ? raw.recipes
    : raw?.ingredients
      ? [raw]
      : []

  const url = sourceText.match(
    /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{11}/i,
  )?.[0]
  return list
    .map((r, i) => namespaceTempIds(mapAiRecipe(r, url), i))
    .filter((r) => r.main.ingredients.length > 0)
}

/** Pure: clean + dedupe a model's bottle list, letting our categorizer win on category. */
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
