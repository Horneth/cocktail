import type { SpiritCategory, Unit } from '../db/schema'
import type { IngredientDraft, RecipeDraft, StructuredImport } from './types'

// Heuristic parser: turns a pasted video description (tuned for the Anders
// Erickson channel's format, but general) into a StructuredImport — the main
// cocktail plus any sub-recipes (syrups/cordials), cross-linked by name.
//
// It is deliberately forgiving and never throws on messy input; whatever it
// can't classify is dropped, and the Import screen shows an editable preview
// so the user corrects anything before saving.

// ---------------------------------------------------------------------------
// Amount + unit parsing
// ---------------------------------------------------------------------------

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25, '½': 0.5, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
}

const UNIT_WORDS: Record<string, Unit> = {
  oz: 'oz', ozs: 'oz', ounce: 'oz', ounces: 'oz',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  cl: 'cl',
  dash: 'dash', dashes: 'dash',
  drop: 'drop', drops: 'drop',
  barspoon: 'barspoon', barspoons: 'barspoon', bsp: 'barspoon',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  part: 'part', parts: 'part',
  cup: 'part', cups: 'part', // ratio recipes: treat cups as parts
  pinch: 'pinch', pinches: 'pinch',
  sprig: 'sprig', sprigs: 'sprig',
  leaf: 'leaf', leaves: 'leaf',
  wedge: 'wedge', wedges: 'wedge',
  slice: 'slice', slices: 'slice',
  piece: 'piece', pieces: 'piece',
  gram: 'g', grams: 'g', g: 'g',
}

/** Parse a leading amount from a line. Returns the value and the remaining text. */
function parseLeadingAmount(line: string): { amount: number | null; rest: string } {
  let s = line.trimStart()

  // "1½" or "½" — whole (optional) followed immediately by a unicode fraction
  const uni = s.match(/^(\d+)?\s*([¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])\s*/)
  if (uni) {
    const whole = uni[1] ? parseInt(uni[1], 10) : 0
    return { amount: whole + UNICODE_FRACTIONS[uni[2]], rest: s.slice(uni[0].length) }
  }

  // mixed ascii "1 1/2" or "1-1/2"
  const mixed = s.match(/^(\d+)[\s-]+(\d+)\/(\d+)\s*/)
  if (mixed) {
    const val = parseInt(mixed[1], 10) + parseInt(mixed[2], 10) / parseInt(mixed[3], 10)
    return { amount: val, rest: s.slice(mixed[0].length) }
  }

  // simple fraction "3/4"
  const frac = s.match(/^(\d+)\/(\d+)\s*/)
  if (frac) {
    return { amount: parseInt(frac[1], 10) / parseInt(frac[2], 10), rest: s.slice(frac[0].length) }
  }

  // decimal / whole ".75", "0.75", "2", "1.5"
  const dec = s.match(/^(\d*\.?\d+)\s*/)
  if (dec) {
    return { amount: parseFloat(dec[1]), rest: s.slice(dec[0].length) }
  }

  return { amount: null, rest: s }
}

/** Consume a unit word from the start of `rest`, if present. */
function parseLeadingUnit(rest: string): { unit: Unit | null; rest: string } {
  const m = rest.match(/^([a-zA-Z.]+)\b\.?\s*/)
  if (m) {
    const word = m[1].toLowerCase().replace(/\.$/, '')
    if (UNIT_WORDS[word]) {
      return { unit: UNIT_WORDS[word], rest: rest.slice(m[0].length) }
    }
  }
  return { unit: null, rest }
}

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

const NOISE = [
  /^https?:\/\//i,
  /\b(instagram|tiktok|twitter|facebook|patreon|youtube|subscribe|follow me|social)\b/i,
  /^\s*chapters?\b/i,
  /^\s*\d{1,2}:\d{2}(:\d{2})?\b/, // timestamps
  /\b(gear i use|affiliate|amazon|my kit|shop|merch|discount|promo code|sponsor)\b/i,
  /\b(filmed|edited|music by|song|producer|camera)\b/i,
  /^[-=*_~#•]{2,}$/, // divider lines
  /©|all rights reserved/i,
]

const METHOD_VERBS =
  /^(shake|stir|build|blend|muddle|combine|add|strain|double.?strain|express|top|pour|fill|dry.?shake|whip|swizzle|churn|garnish with|serve|chill|rinse|flame)\b/i

const TOPPER = /\b(soda|tonic|champagne|prosecco|sparkling|ginger beer|ginger ale|cola|beer|cider|to top|top with|float|splash)\b/i

const COMPONENT_KEYWORDS =
  /\b(syrup|cordial|orgeat|grenadine|shrub|tincture|puree|purée|foam|oleo|sherbet|honey|falernum|mix|reduction|infusion|bitters?\b(?! ?$))\b/i

const SPIRIT_HINTS: [RegExp, SpiritCategory][] = [
  [/\bgin\b/i, 'gin'],
  [/\b(rye|bourbon|whiskey|whisky|scotch)\b/i, 'whiskey'],
  [/\bmezcal\b/i, 'agave'],
  [/\btequila\b/i, 'tequila'],
  [/\b(rum|rhum|cacha[çc]a)\b/i, 'rum'],
  [/\bvodka\b/i, 'vodka'],
  [/\b(cognac|brandy|pisco|armagnac|calvados)\b/i, 'brandy'],
  [/\b(wine|vermouth|sherry|port|prosecco|champagne)\b/i, 'wine'],
]

type Line =
  | { type: 'ingredient'; ing: IngredientDraft }
  | { type: 'header'; text: string; component: boolean }
  | { type: 'garnish'; text: string }
  | { type: 'method'; text: string }
  | { type: 'glass'; text: string }
  | { type: 'blank' }

function isNoise(line: string): boolean {
  return NOISE.some((re) => re.test(line))
}

/** Try to read a line as an ingredient. Returns null if it isn't one. */
function asIngredient(line: string): IngredientDraft | null {
  const { amount, rest } = parseLeadingAmount(line)

  if (amount !== null) {
    const { unit, rest: afterUnit } = parseLeadingUnit(rest)
    const name = cleanName(stripMeasurementParens(afterUnit))
    if (!name) return null
    return { amount, unit: unit ?? 'each', name }
  }

  // no amount — only accept obvious toppers (soda, champagne to top, …)
  if (TOPPER.test(line) && wordCount(line) <= 6 && !METHOD_VERBS.test(line)) {
    return { amount: null, unit: 'top', name: cleanName(line) }
  }
  return null
}

function cleanName(s: string): string {
  return s
    .replace(/^[\s\-–—:•*]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Drop a parenthetical secondary measurement like "(30 ml)" or "(1 1/2 oz)"
 * that descriptions add after the primary amount, e.g.
 *   "1 oz. (30 ml) Lemon Juice" -> "Lemon Juice"
 * Non-measurement parentheses (e.g. a "(1.5:1)" ratio hint) are left intact.
 */
function stripMeasurementParens(s: string): string {
  return s
    .replace(
      /\(\s*[\d.,/\s]*(?:ml|milliliters?|millilitres?|cl|oz|ounces?|grams?|g|parts?|dashes?)\b[^)]*\)/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim()
}

function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length
}

function classify(raw: string): Line {
  const line = raw.trim()
  if (!line) return { type: 'blank' }

  const garnish = line.match(/^garnish\b\s*[:\-]?\s*(.+)$/i)
  if (garnish) return { type: 'garnish', text: cleanName(garnish[1]) }

  const glass = line.match(/^glass(?:ware)?\b\s*[:\-]?\s*(.+)$/i)
  if (glass) return { type: 'glass', text: cleanName(glass[1]) }

  const ing = asIngredient(line)
  if (ing) return { type: 'ingredient', ing }

  if (METHOD_VERBS.test(line) || wordCount(line) > 7) {
    return { type: 'method', text: line }
  }

  // otherwise a short non-ingredient line => a header (recipe or section title)
  const bare = line.replace(/[:\-–—]+\s*$/, '').trim()
  return { type: 'header', text: bare, component: COMPONENT_KEYWORDS.test(bare) }
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

let counter = 0
function tempId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, '') // drop "(1.5:1)"
    .replace(/\b(semi-?rich|rich|fresh|homemade|cold|hot|pure)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectSpirit(main: RecipeDraft): SpiritCategory | undefined {
  const hay = main.ingredients.map((i) => i.name).join(' ')
  for (const [re, spirit] of SPIRIT_HINTS) if (re.test(hay)) return spirit
  return undefined
}

function detectMethod(text: string): string | undefined {
  if (/\bstir/i.test(text)) return 'Stir'
  if (/\bshake/i.test(text)) return 'Shake'
  if (/\bblend/i.test(text)) return 'Blend'
  if (/\b(build|muddle|top|pour over)/i.test(text)) return 'Build'
  return undefined
}

function findSourceUrl(text: string): { url?: string; videoId?: string } {
  const m = text.match(/https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/i)
  if (m) return { url: m[0], videoId: m[1] }
  return {}
}

export interface ParseResult extends StructuredImport {
  /** true if we found at least a name and one ingredient */
  ok: boolean
}

export function parseRecipeText(text: string): ParseResult {
  counter = 0
  const lines = text.split(/\r?\n/).filter((l) => !isNoise(l))
  const classified = lines.map(classify)

  const main: RecipeDraft = {
    tempId: tempId('main'),
    kind: 'cocktail',
    name: '',
    ingredients: [],
    measureBasis: 'absolute',
    tags: [],
  }
  const components: RecipeDraft[] = []
  let current: RecipeDraft = main
  const methodParts: string[] = []

  for (let i = 0; i < classified.length; i++) {
    const tok = classified[i]
    switch (tok.type) {
      case 'header': {
        // The first header before any main ingredient names the cocktail.
        if (current === main && main.ingredients.length === 0 && !main.name) {
          main.name = tok.text
          break
        }
        // A component header (syrup/cordial/…) or any header that follows the
        // main's ingredients starts a new sub-recipe.
        if (tok.component || current === main) {
          const comp: RecipeDraft = {
            tempId: tempId('comp'),
            kind: 'component',
            name: tok.text,
            ingredients: [],
            measureBasis: 'parts',
            tags: [],
          }
          components.push(comp)
          current = comp
        } else {
          current.name ||= tok.text
        }
        break
      }
      case 'ingredient':
        current.ingredients.push(tok.ing)
        break
      case 'garnish':
        if (!main.garnish) main.garnish = tok.text
        break
      case 'glass':
        if (!main.glassware) main.glassware = tok.text
        break
      case 'method':
        // Only keep method prose once the recipe has started — this drops the
        // intro sentence(s) many descriptions open with.
        if (current === main && main.ingredients.length > 0) methodParts.push(tok.text)
        break
      case 'blank':
        break
    }
  }

  // finalize component measure basis (absolute if no parts units were used)
  for (const c of components) {
    c.measureBasis = c.ingredients.some((i) => i.unit === 'part') ? 'parts' : 'absolute'
  }

  // cross-link main ingredients to components by name
  const compByName = new Map(components.map((c) => [normalize(c.name), c]))
  for (const ing of main.ingredients) {
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

  if (methodParts.length) main.instructions = methodParts.join(' ')
  main.method = detectMethod(main.instructions ?? '')
  main.spirit = detectSpirit(main)

  const src = findSourceUrl(text)
  main.source = { type: src.url ? 'youtube' : 'web', ...src, channel: 'Anders Erickson' }

  const ok = main.name.trim() !== '' && main.ingredients.length > 0
  if (!main.name) main.name = 'Imported cocktail'

  return { main, components, ok }
}
