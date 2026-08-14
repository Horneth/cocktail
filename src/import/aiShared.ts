import { coerceUnit } from '../domain/units'
import { normalizeComponentName } from '../domain/textNormalize'
import { normIngredient } from '../domain/availability'
import { categoryForName } from '../domain/spiritCategory'
import { GLASSES, METHODS, canonical } from '../domain/vocab'
import type { RecipeKind, SpiritCategory } from '../db/schema'
import { GUESSABLE_FIELDS } from './types'
import type { GuessedField, IngredientDraft, RecipeDraft, StructuredImport } from './types'

// Transport-agnostic AI core: the shapes a model is expected to return, and the
// pure mappers that turn that raw JSON into our StructuredImport. A backend only
// has to produce the raw shapes below (`AiRecipe` / `{ bottles }`); all
// normalization — and all validation of what the model claims — lives here.

// The structured-output schemas and the four prompts used to live here. Both
// now live in the published server prompt templates — authored copies in
// `docs/prompt-templates/`, deployed copies in the Firebase project — because
// a prompt in two places is a prompt that drifts. What is left is the part a
// transport cannot supply: the shapes a model is expected to return, and the
// mappers that turn that raw JSON into our own types, which is still where
// every cross-reference the model claims gets checked against what we asked.

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

/**
 * How long a model-authored string may be, per field. These are containment
 * limits, not validation: they exist so one absurd value can't dominate a
 * recipe card, a bar label, or — via the shelf scan's second pass — a prompt.
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
        name: cleanModelText(c.name, TEXT_CAPS.name),
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
  const method = canonical(cleanModelText(r.method, TEXT_CAPS.serve), METHODS)
  const glassware = isComponent
    ? undefined
    : canonical(cleanModelText(r.glassware, TEXT_CAPS.serve), GLASSES)
  const garnish = isComponent ? undefined : cleanModelText(r.garnish, TEXT_CAPS.garnish) || undefined
  const spirit = isComponent ? undefined : coerceSpirit(r.spirit)

  const main: RecipeDraft = {
    tempId: tempId('main'),
    kind,
    name:
      cleanModelText(r.name, TEXT_CAPS.name) ||
      (kind === 'component' ? 'Imported syrup' : 'Imported cocktail'),
    ingredients,
    // a component described in "1 part" ratios is a parts recipe
    measureBasis:
      kind === 'component' && ingredients.some((i) => i.unit === 'part') ? 'parts' : 'absolute',
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
