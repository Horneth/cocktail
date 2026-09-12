import { coerceUnit } from '../domain/units'
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

// One recipe: a cocktail or a syrup. Each stands alone.
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
  },
  required: ['name', 'ingredients'],
}

// A single video description often contains SEVERAL recipes, so we ask for a
// list. Each entry is a self-contained recipe.
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
export const PROMPT = `You extract EVERY recipe from a pasted recipe or video description. A single description frequently contains SEVERAL recipes — return all of them.
Return JSON matching the schema: a "recipes" array with one entry per recipe, in the order they appear. Each entry is a self-contained recipe. Rules per recipe:
- "name": the recipe's name only (no channel or video title fluff).
- "kind": "cocktail" for a drink someone sits down and pours, or "syrup" for anything that is an INGREDIENT in drinks rather than a drink itself — a sweetened mixer (simple syrup, orgeat, grenadine, honey syrup) as well as a spirit-based infusion or liqueur-style ingredient (limoncello, coffee liqueur, fruit cordial). When the description gives such a mixer its own recipe, emit it as its own top-level entry with kind "syrup". Never nest one recipe inside another.
- "ingredients": each line of that recipe's build. Keep the amount as a number in the unit as written (oz, ml, cl, dash, barspoon, tsp, tbsp, part). Use amount null for "to taste", garnishes, or "top with" items. Strip any parenthetical unit conversion like "(30 ml)" from the name.
- "spirit": the primary base spirit of a cocktail, as a short lowercase word. Use the SPECIFIC spirit the recipe names — e.g. gin, vodka, rum, cachaça, whiskey, tequila, mezcal, brandy, cognac, pisco, sake, wine, liqueur. Do NOT collapse a specific spirit into a broader one (a Caipirinha is "cachaça", not "rum"). Only normalize spelling/family: bourbon/rye/scotch/whisky -> whiskey. Use "mocktail" for any non-alcoholic / zero-proof / "virgin" drink. Omit spirit for a syrup.
- "method": how a cocktail is built. Use exactly one of: ${METHODS.join(', ')}. Omit for a syrup.
- "glassware": what a cocktail is served in. Use exactly one of: ${GLASSES.join(', ')} — unless the text names a different vessel, in which case use the text's. Omit for a syrup.
- "garnish": the garnish, as short as possible ("Lime wheel", "Orange peel"). Omit for a syrup.
- "tags": 2 to 4 tags describing style and flavour, taken from this list: ${TAG_KEYS.join(', ')}. Use "syrup" for a syrup. No "#".
- "aka": 0 to 3 other names this exact recipe is commonly known by, PLUS the name of the classic it is a variation of when it clearly is one (a "Oaxacan Old Fashioned" gets ["Old Fashioned"]; a "Rum Sour" made with rum, lime and sugar gets ["Daiquiri"]). Leave empty for an original recipe with no ancestor.
- "guessed": ALWAYS fill in "method", "glassware", "garnish" and "tags" — when the text does not state one, infer the standard serve for that drink from your own bartending knowledge, and list that field's name here. Also list "spirit" or "kind" if you inferred those. A field is "guessed" only when the text did not state it; do not list fields you read straight from the text. NEVER guess ingredients or amounts — those come from the text only, and a recipe with no ingredients in the text is not a recipe.
- Ignore non-recipe text: links, chapters/timestamps, gear lists, socials, sponsorships.
- Do not invent ingredients. If the description has exactly one recipe, return a one-element "recipes" array.`

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

/**
 * How long a model-authored string may be, per field. These are containment
 * limits, not validation: they exist so one absurd value can't dominate a
 * recipe card, a bar label, or — via `buildReconcilePrompt` — a second prompt.
 * Generous enough that no honest answer is ever clipped.
 */
export const TEXT_CAPS = {
  name: 120,
  garnish: 80,
  instructions: 2000,
  note: 200,
  reason: 120,
  bottle: 80,
  tag: 32,
  /** unlisted method/glassware/spirit, which `canonical` passes through verbatim */
  serve: 40,
} as const

// Control characters, minus \n when the caller keeps line breaks.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g
const CONTROL_KEEP_NL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g

/**
 * Pure: clamp a model-authored string before it reaches the UI, the DB, or a
 * second prompt.
 *
 * Everything a model returns is untrusted — the text it read was pasted by
 * someone, and the labels it read were photographed by someone — so a value can
 * carry newlines and control characters that forge structure downstream, or
 * megabytes of padding. Strip and cap here, once, rather than at each use.
 * This is containment only: the callers below still check every cross-reference
 * against what we actually asked for, which is what stops an invented match.
 */
export function cleanModelText(
  value: unknown,
  max: number,
  opts: { newlines?: boolean } = {},
): string {
  if (typeof value !== 'string') return ''
  const stripped = value.replace(opts.newlines ? CONTROL_KEEP_NL : CONTROL, ' ')
  const collapsed = opts.newlines
    ? stripped.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n')
    : stripped.replace(/\s+/g, ' ')
  return collapsed.trim().slice(0, max).trim()
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
  const w = cleanModelText(raw, TEXT_CAPS.serve).toLowerCase()
  if (!w || w === 'none') return undefined
  return SPIRIT_SYNONYMS[w] ?? w
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const v = cleanModelText(t, TEXT_CAPS.tag).toLowerCase().replace(/^#/, '')
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
    const v = cleanModelText(a, TEXT_CAPS.name)
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
    name: cleanModelText(g.name, TEXT_CAPS.name),
    amount: g.amount ?? null,
    unit: coerceUnit(g.unit),
  }
  if (g.optional) ing.optional = true
  const note = cleanModelText(g.note, TEXT_CAPS.note)
  if (note) ing.note = note
  return ing
}

/**
 * Pure: map a raw AI recipe JSON object into our StructuredImport. `sourceText`
 * (when given) is what the model was shown — used only to sanity-check its
 * `guessed` claims, never to parse anything. The model never invents cross-links;
 * ingredients are plain names here, and linking happens in the editor.
 */
export function mapAiRecipe(r: AiRecipe, sourceUrl?: string, sourceText = ''): StructuredImport {
  counter = 0
  const ingredients = (r.ingredients ?? []).map(toDraftIngredient).filter((i) => i.name)

  const videoId = sourceUrl?.match(/(?:v=|youtu\.be\/)([\w-]{11})/)?.[1]
  // A model trained on the older kind lists may still say "component" or
  // "cordial" — both fold into "syrup". Anything else unknown is treated as a
  // cocktail.
  const kind: RecipeKind =
    r.kind === 'syrup' || r.kind === 'component' || r.kind === 'cordial'
      ? 'syrup'
      : 'cocktail'
  // A syrup is an ingredient, not a serve — a glass or garnish on one is
  // the model over-applying the "always fill these in" rule.
  const isCocktailKind = kind === 'cocktail'
  const method = isCocktailKind
    ? canonical(cleanModelText(r.method, TEXT_CAPS.serve), METHODS)
    : undefined
  const glassware = isCocktailKind
    ? canonical(cleanModelText(r.glassware, TEXT_CAPS.serve), GLASSES)
    : undefined
  const garnish = isCocktailKind
    ? cleanModelText(r.garnish, TEXT_CAPS.garnish) || undefined
    : undefined
  const spirit = isCocktailKind ? coerceSpirit(r.spirit) : undefined

  const main: RecipeDraft = {
    tempId: tempId('main'),
    kind,
    name:
      cleanModelText(r.name, TEXT_CAPS.name) ||
      (isCocktailKind ? 'Imported cocktail' : 'Imported recipe'),
    ingredients,
    // a mixer described in "1 part" ratios is a parts recipe
    measureBasis:
      !isCocktailKind && ingredients.some((i) => i.unit === 'part') ? 'parts' : 'absolute',
    method,
    glassware,
    garnish,
    instructions: cleanModelText(r.instructions, TEXT_CAPS.instructions, { newlines: true }) || undefined,
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
    ...(guessed.length ? { guessed } : {}),
    ...(aka.length ? { aka } : {}),
  }
}

// mapAiRecipe resets its tempId counter per call, so ids collide across the
// recipes of one batch. Re-namespace each import's tempId so a multi-recipe
// preview can key everything uniquely.
export function namespaceTempIds(imp: StructuredImport, i: number): StructuredImport {
  return {
    ...imp,
    main: { ...imp.main, tempId: `r${i}.${imp.main.tempId}` },
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
    const reason = cleanModelText(v.reason, TEXT_CAPS.reason)
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
    // Cleaned here rather than at each use: this list feeds the review sheet,
    // the pantry label, AND pass 2's prompt, and the last of those makes a
    // photographed label into prompt text.
    const name = cleanModelText(b.name, TEXT_CAPS.bottle)
    const key = normIngredient(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const fromModel = cleanModelText(b.category, TEXT_CAPS.serve).toLowerCase() || undefined
    const brand = cleanModelText(b.brand, TEXT_CAPS.bottle)
    out.push({
      name,
      category: categoryForName(name) ?? fromModel,
      ...(brand ? { brand } : {}),
      // Anything but an explicit "low" is treated as readable — an omitted
      // confidence shouldn't quietly untick a bottle in the review sheet.
      ...(cleanModelText(b.confidence, TEXT_CAPS.serve).toLowerCase() === 'low'
        ? { confidence: 'low' as const }
        : {}),
    })
  }
  return out
}

/**
 * Pure: the text sent for pass 2. Only the detected names and their few local
 * candidates travel — never the rest of the bar. Entries with no candidates are
 * dropped, since there is nothing for the model to compare them against; when
 * that empties the list the caller skips the call entirely.
 *
 * The payload is JSON, matching its twin `firebaseJudgeDuplicates`. That is not
 * cosmetic: `detected` is pass-1 output, so it is ultimately whatever was
 * printed on a photographed label, and hand-quoting it into prose let a label
 * close the quote and write instructions for the *other* entries in the batch.
 * `JSON.stringify` escapes it properly; `dedupeBottles` already stripped the
 * control characters.
 */
export function buildReconcilePrompt(inputs: ReconcileInput[]): string {
  const payload = inputs
    .filter((i) => i.candidates.length > 0)
    .map((i) => ({
      detected: i.detected,
      ...(i.category ? { category: i.category } : {}),
      candidates: i.candidates,
    }))
  return `${RECONCILE_PROMPT}\n\nDETECTED:\n${JSON.stringify(payload)}`
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
    // Becomes a pantry label if the user ticks the row — the one model-authored
    // string that reaches stored data, so it gets the same cap as a bottle name.
    const canonicalName = cleanModelText(m.canonicalName, TEXT_CAPS.bottle)
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
