import { coerceUnit } from '../domain/units'
import { normalizeComponentName } from '../domain/textNormalize'
import { normIngredient } from '../domain/availability'
import { categoryForName } from '../domain/spiritCategory'
import { GLASSES, METHODS, TAG_KEYS, canonical } from '../domain/vocab'
import type { RecipeKind, SpiritCategory } from '../db/schema'
import { GUESSABLE_FIELDS } from './types'
import type { GuessedField, IngredientDraft, RecipeDraft, StructuredImport } from './types'

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
    // Fields the model INFERRED rather than read. Drives the "✨ guessed" marks
    // in the import preview so a user can see what to double-check.
    guessed: { type: 'array', items: { type: 'string' } },
    // Alternate names for the drink, including the classic it riffs on. Lets us
    // shortlist library duplicates locally ("Rum Sour" → your Daiquiri) without
    // shipping the library to the cloud.
    aka: { type: 'array', items: { type: 'string' } },
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

export const DUPE_SCHEMA: OpenApiSchema = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          match: { type: 'string' },
          relation: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['index', 'relation'],
      },
    },
  },
  required: ['verdicts'],
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
          brand: { type: 'string' },
          category: { type: 'string' },
          confidence: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  required: ['bottles'],
}

// Pass 2 of the shelf scan. The model gets each detected bottle plus the few
// bottles the user already has that *look* closest (picked on-device by
// `domain/bottleMatch`), and decides which are genuinely the same. Deciding
// that "Tanqueray No. Ten" is not "Tanqueray" is a judgement call about bottles,
// which is exactly the part worth spending a call on.
export const RECONCILE_SCHEMA: OpenApiSchema = {
  type: 'object',
  properties: {
    matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          detected: { type: 'string' },
          verdict: { type: 'string' },
          match: { type: 'string' },
          canonicalName: { type: 'string' },
        },
        required: ['detected', 'verdict'],
      },
    },
  },
  required: ['matches'],
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
// Built from `domain/vocab.ts` so the model, the recipe editor and the import
// preview can never drift onto three different tag/method/glass vocabularies.
export const PROMPT = `You extract EVERY drink recipe from a pasted recipe or video description. A single description frequently contains SEVERAL cocktails — return all of them.
Return JSON matching the schema: a "recipes" array with one entry per drink, in the order they appear. Rules per recipe:
- "name": the drink's name only (no channel or video title fluff).
- "kind": "cocktail" for a drink someone sits down and drinks, OR "component" for a syrup/cordial/orgeat/infusion/tincture/mix — something that is an INGREDIENT in a drink rather than a drink itself. A component has no glass, no garnish and no serve. Prefer attaching a syrup as a "subRecipes" entry of the cocktail that uses it; only emit a top-level "component" recipe when the syrup stands entirely on its own with no cocktail alongside it.
- "ingredients": each line of that drink's build. Keep the amount as a number in the unit as written (oz, ml, cl, dash, barspoon, tsp, tbsp, part). Use amount null for "to taste", garnishes, or "top with" items. Strip any parenthetical unit conversion like "(30 ml)" from the name.
- "subRecipes": any syrups/cordials/orgeat/etc. that drink relies on, described as their OWN ingredient block. Use unit "part" for ratio recipes ("1 part sugar"). Give each the EXACT name used in that drink's ingredient list so they can be linked. If two cocktails share the same syrup, include it under each. Always split these out rather than leaving them as one ingredient.
- "spirit": the primary base spirit as a short lowercase word. Use the SPECIFIC spirit the recipe names — e.g. gin, vodka, rum, cachaça, whiskey, tequila, mezcal, brandy, cognac, pisco, sake, wine, liqueur. Do NOT collapse a specific spirit into a broader one (a Caipirinha is "cachaça", not "rum"). Only normalize spelling/family: bourbon/rye/scotch/whisky -> whiskey. Use "mocktail" for any non-alcoholic / zero-proof / "virgin" drink. Omit spirit for a component/syrup.
- "method": how it is built. Use exactly one of: ${METHODS.join(', ')}.
- "glassware": what it is served in. Use exactly one of: ${GLASSES.join(', ')} — unless the text names a different vessel, in which case use the text's.
- "garnish": the garnish, as short as possible ("Lime wheel", "Orange peel").
- "tags": 2 to 4 tags describing style and flavour, taken from this list: ${TAG_KEYS.join(', ')}. Use "syrup" for a component. No "#".
- "aka": 0 to 3 other names this exact drink is commonly known by, PLUS the name of the classic it is a variation of when it clearly is one (a "Oaxacan Old Fashioned" gets ["Old Fashioned"]; a "Rum Sour" made with rum, lime and sugar gets ["Daiquiri"]). Leave empty for an original drink with no ancestor.
- "guessed": ALWAYS fill in "method", "glassware", "garnish" and "tags" — when the text does not state one, infer the standard serve for that drink from your own bartending knowledge, and list that field's name here. Also list "spirit" or "kind" if you inferred those. A field is "guessed" only when the text did not state it; do not list fields you read straight from the text. NEVER guess ingredients or amounts — those come from the text only, and a drink with no ingredients in the text is not a recipe.
- Ignore non-recipe text: links, chapters/timestamps, gear lists, socials, sponsorships.
- Do not invent ingredients. If the description has exactly one drink, return a one-element "recipes" array.`

// Second pass: only the names that already survived a LOCAL fuzzy match are sent
// here, so the payload is a handful of strings rather than the user's library.
export const DUPE_PROMPT = `You decide whether drinks someone is importing are already in their collection.
For each entry you get the incoming drink's "name", its "aka" (other names/ancestors), and "candidates" — names already in the collection that looked similar.
Judge on the DRINK'S IDENTITY, not on the exact proportions: the same classic written by two bartenders with slightly different specs is still the same drink, and a named riff is still its own drink.
Return one verdict per entry, echoing its "index":
- "relation": "same" when a candidate IS this drink (including the same classic under another name — a "Rum Sour" of rum/lime/sugar is a Daiquiri).
- "relation": "variation" when this drink is a recognised riff ON a candidate but is its own named drink (Oaxacan Old Fashioned vs Old Fashioned, Hemingway Daiquiri vs Daiquiri).
- "relation": "different" when no candidate is related — a shared word in the name is not a relationship.
- "match": the candidate name EXACTLY as given, or omit it when the relation is "different".
- "reason": at most 8 words, addressed to the user ("same drink, different name", "adds mezcal and agave"). No preamble.`

export const VISION_PROMPT = `You are looking at photo(s) of a home bar or liquor shelf. List every distinct liquor, spirit, wine, or liqueur BOTTLE you can identify.
- "name": the bottle's full name as printed, brand plus expression (e.g. "Woodford Reserve", "Tanqueray No. Ten", "Campari"). If the brand is unreadable but the type is clear, use the type (e.g. "London dry gin"). No bottle size, no ABV, no age unless it is part of the name.
- "brand": the producer alone (e.g. "Woodford Reserve", "Tanqueray", "Plantation"). Omit if unreadable.
- "category": a short lowercase base category — one of gin, vodka, rum, whiskey, tequila, mezcal, brandy, cognac, cachaça, pisco, wine, liqueur. Omit if unsure.
- "confidence": "high" when you can read the label clearly, "low" when you are inferring from bottle shape, colour, or a partial label.
- One entry per distinct bottle. Ignore glassware, mixers, garnishes and non-bottle items. Do not invent bottles you cannot clearly see.`

export const RECONCILE_PROMPT = `You are matching bottles just detected in a photo against bottles the user already has in their bar.
For each DETECTED bottle you are given the few existing bottles whose names look closest. Return one entry per DETECTED bottle, repeating its name verbatim in "detected", with a "verdict":
- "same": it IS one of the listed bottles, written differently ("Plantation 3 Stars" vs "Plantation Three Stars White Rum"). Set "match" to the existing name EXACTLY as listed.
- "variant": the same producer or family, but a genuinely different bottle the user would want to keep separately ("Tanqueray No. Ten" vs "Tanqueray", "Plantation O.F.T.D." vs "Plantation 3 Stars"). Set "match" to the closest existing name.
- "new": none of the listed bottles is the same bottle or a near variant.
Judge on the bottle's identity, not on string similarity. Different expressions, age statements or proofs of one brand are "variant", never "same".
Also return "canonicalName": the cleanest display name for the detected bottle — brand plus expression, no bottle size, no ABV.`

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
  guessed?: string[]
  aka?: string[]
  ingredients?: AiIngredient[]
  subRecipes?: { name?: string; ingredients?: AiIngredient[] }[]
}

export interface IdentifiedBottle {
  name: string
  brand?: string
  category?: string
  /** 'low' when the model was reading a partial label — the UI pre-unticks these */
  confidence?: 'high' | 'low'
}

/** One detected bottle plus the few existing bottles worth comparing it against. */
export interface ReconcileInput {
  detected: string
  category?: string
  /** existing bottle labels, picked on-device by `domain/bottleMatch` */
  candidates: string[]
}

export interface ReconcileMatch {
  detected: string
  verdict: 'same' | 'variant' | 'new'
  /** the existing label this points at, when the verdict names one */
  match?: string
  canonicalName?: string
}

// ── Duplicate detection ────────────────────────────────────────────────────
export type DupeRelation = 'same' | 'variation' | 'different'

/** One incoming drink plus the library names a local pass thought looked close. */
export interface DupeQuery {
  index: number
  name: string
  aka: string[]
  candidates: string[]
}

export interface DupeVerdict {
  index: number
  relation: DupeRelation
  /** the candidate name the model matched, verbatim; absent when `different` */
  match?: string
  reason?: string
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

function normalizeAka(aka: string[] | undefined): string[] {
  if (!aka) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const a of aka) {
    const v = a.trim()
    const key = v.toLowerCase()
    if (v && !seen.has(key)) {
      seen.add(key)
      out.push(v)
    }
  }
  return out.slice(0, 4)
}

/**
 * Reconcile the model's self-reported `guessed` list against the source text.
 *
 * Models are unreliable narrators about their own reasoning in both directions:
 * they mark a field as inferred when they actually read it, and they quietly
 * invent a glass without saying so. The text is the ground truth we have, so a
 * field whose value appears in the source is never a guess, and a field with a
 * value that appears nowhere in the source always is. Only `tags` and `kind`
 * fall back to the model's own claim — neither is a literal quote.
 */
function reconcileGuessed(
  claimed: string[] | undefined,
  values: Partial<Record<GuessedField, string | undefined>>,
  sourceText: string,
): GuessedField[] {
  const said = new Set((claimed ?? []).map((f) => f.trim().toLowerCase()))
  const haystack = sourceText.toLowerCase()
  const out: GuessedField[] = []
  for (const field of GUESSABLE_FIELDS) {
    const value = values[field]
    if (field === 'tags' || field === 'kind') {
      if (said.has(field)) out.push(field)
      continue
    }
    if (!value) continue
    if (!haystack.includes(value.toLowerCase())) out.push(field)
  }
  return out
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

/**
 * Pure: map a raw AI recipe JSON object into our StructuredImport, wiring
 * cross-links by name. `sourceText` (when given) is what the model was shown —
 * used only to sanity-check its `guessed` claims, never to parse anything.
 */
export function mapAiRecipe(r: AiRecipe, sourceUrl?: string, sourceText = ''): StructuredImport {
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
  // A component is an ingredient, not a serve — a glass or garnish on one is the
  // model over-applying the "always fill these in" rule.
  const isComponent = kind === 'component'
  const method = canonical(r.method, METHODS)
  const glassware = isComponent ? undefined : canonical(r.glassware, GLASSES)
  const garnish = isComponent ? undefined : r.garnish?.trim() || undefined
  const spirit = isComponent ? undefined : coerceSpirit(r.spirit)

  const main: RecipeDraft = {
    tempId: tempId('main'),
    kind,
    name: (r.name ?? '').trim() || (kind === 'component' ? 'Imported syrup' : 'Imported cocktail'),
    ingredients,
    // a component described in "1 part" ratios is a parts recipe
    measureBasis:
      kind === 'component' && ingredients.some((i) => i.unit === 'part') ? 'parts' : 'absolute',
    method,
    glassware,
    garnish,
    instructions: r.instructions,
    tags: normalizeTags(r.tags),
    spirit,
    source: {
      type: sourceUrl ? 'youtube' : 'web',
      ...(sourceUrl ? { url: sourceUrl, videoId } : {}),
    },
  }

  const guessed = reconcileGuessed(
    r.guessed,
    { method, glassware, garnish, spirit, tags: undefined, kind: undefined },
    sourceText,
  )
  const aka = normalizeAka(r.aka)

  return {
    main,
    components,
    ...(guessed.length ? { guessed } : {}),
    ...(aka.length ? { aka } : {}),
  }
}

// mapAiRecipe resets its tempId counter per call, so ids collide across the
// recipes of one batch. Re-namespace each import's tempIds (and the matching
// subRecipeRefs) so a multi-recipe preview can key everything uniquely.
export function namespaceTempIds(imp: StructuredImport, i: number): StructuredImport {
  const rename = (id: string) => `r${i}.${id}`
  return {
    ...imp,
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
    .map((r, i) => namespaceTempIds(mapAiRecipe(r, url, sourceText), i))
    .filter((r) => r.main.ingredients.length > 0)
}

/**
 * Pure: clean a model's duplicate verdicts. Drops entries whose index or match
 * we didn't ask about — a hallucinated match name would otherwise render as
 * "already in your library · <drink you don't own>". Unknown relations degrade
 * to `different` so a bad verdict can only ever under-flag, never block an
 * import the user wanted.
 */
export function finishDupeJudgement(parsed: unknown, queries: DupeQuery[]): DupeVerdict[] {
  const raw = (parsed as { verdicts?: unknown[] })?.verdicts
  if (!Array.isArray(raw)) return []
  const byIndex = new Map(queries.map((q) => [q.index, q]))
  const out: DupeVerdict[] = []
  const seen = new Set<number>()

  for (const entry of raw) {
    const v = entry as { index?: unknown; relation?: unknown; match?: unknown; reason?: unknown }
    const index = typeof v.index === 'number' ? v.index : NaN
    const query = byIndex.get(index)
    if (!query || seen.has(index)) continue

    const relation: DupeRelation =
      v.relation === 'same' || v.relation === 'variation' ? v.relation : 'different'
    if (relation === 'different') continue

    const claimed = typeof v.match === 'string' ? v.match.trim() : ''
    const match = query.candidates.find((c) => c.toLowerCase() === claimed.toLowerCase())
    if (!match) continue

    seen.add(index)
    const reason = typeof v.reason === 'string' ? v.reason.trim() : ''
    out.push({ index, relation, match, ...(reason ? { reason } : {}) })
  }
  return out
}

/** Pure: clean + dedupe a model's bottle list, letting our categorizer win on category. */
export function dedupeBottles(
  raw: { name?: string; brand?: string; category?: string; confidence?: string }[],
): IdentifiedBottle[] {
  const seen = new Set<string>()
  const out: IdentifiedBottle[] = []
  for (const b of raw) {
    const name = (b.name ?? '').trim()
    const key = normIngredient(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const fromModel = b.category?.trim().toLowerCase() || undefined
    const brand = b.brand?.trim()
    out.push({
      name,
      category: categoryForName(name) ?? fromModel,
      ...(brand ? { brand } : {}),
      // Anything but an explicit "low" is treated as readable — an omitted
      // confidence shouldn't quietly untick a bottle in the review sheet.
      ...(b.confidence?.trim().toLowerCase() === 'low' ? { confidence: 'low' as const } : {}),
    })
  }
  return out
}

/**
 * Pure: the text sent for pass 2. Only the detected names and their few local
 * candidates travel — never the rest of the bar. Entries with no candidates are
 * dropped, since there is nothing for the model to compare them against; when
 * that empties the list the caller skips the call entirely.
 */
export function buildReconcilePrompt(inputs: ReconcileInput[]): string {
  const lines = inputs
    .filter((i) => i.candidates.length > 0)
    .map((i, n) => {
      const category = i.category ? ` [${i.category}]` : ''
      const candidates = i.candidates.map((c) => `"${c}"`).join(', ')
      return `${n + 1}. "${i.detected}"${category} — already in the bar: ${candidates}`
    })
  return `${RECONCILE_PROMPT}\n\nDETECTED:\n${lines.join('\n')}`
}

const VERDICTS = new Set(['same', 'variant', 'new'])

/**
 * Pure: validate a reconcile response against what we actually asked about.
 * The model is told to echo each detected name, so anything it returns that we
 * didn't send is dropped, and a `match` that isn't one of that entry's own
 * candidates is discarded rather than trusted — a hallucinated match would
 * silently hide a real bottle from the review sheet.
 */
export function parseReconcile(parsed: unknown, inputs: ReconcileInput[]): ReconcileMatch[] {
  const raw = (parsed as { matches?: unknown[] })?.matches
  if (!Array.isArray(raw)) return []

  const asked = new Map(inputs.map((i) => [normIngredient(i.detected), i]))
  const seen = new Set<string>()
  const out: ReconcileMatch[] = []
  for (const entry of raw) {
    const m = entry as { detected?: string; verdict?: string; match?: string; canonicalName?: string }
    const key = normIngredient(m.detected ?? '')
    const input = asked.get(key)
    if (!input || seen.has(key)) continue
    seen.add(key)

    const verdict = m.verdict?.trim().toLowerCase()
    if (!verdict || !VERDICTS.has(verdict)) continue

    const match = input.candidates.find((c) => normIngredient(c) === normIngredient(m.match ?? ''))
    const canonicalName = m.canonicalName?.trim()
    out.push({
      detected: input.detected,
      // A same/variant verdict is meaningless without a candidate to point at.
      verdict: verdict === 'new' || match ? (verdict as ReconcileMatch['verdict']) : 'new',
      ...(match ? { match } : {}),
      ...(canonicalName ? { canonicalName } : {}),
    })
  }
  return out
}
