import type { Unit } from '../db/schema'

export interface UnitDef {
  id: Unit
  label: string
  plural?: string
  /** ml per 1 unit; present => convertible volume unit */
  ml?: number
  /** increment used by the inline tweaker, in the unit's own terms */
  step: number
  /** whether the amount reads better as a prefixed word ("2 dashes X") vs "X 2 dashes" */
  prefix?: boolean
}

// US bar conventions. `oz` is treated as 30 ml (not 29.57) — the bartending
// convention that keeps oz<->ml math clean and pours honest.
export const UNITS: Record<Unit, UnitDef> = {
  oz: { id: 'oz', label: 'oz', ml: 30, step: 0.25 },
  ml: { id: 'ml', label: 'ml', ml: 1, step: 5 },
  cl: { id: 'cl', label: 'cl', ml: 10, step: 0.5 },
  dash: { id: 'dash', label: 'dash', plural: 'dashes', ml: 0.8, step: 1, prefix: true },
  drop: { id: 'drop', label: 'drop', plural: 'drops', ml: 0.05, step: 1, prefix: true },
  barspoon: { id: 'barspoon', label: 'barspoon', plural: 'barspoons', ml: 5, step: 0.5, prefix: true },
  tsp: { id: 'tsp', label: 'tsp', ml: 5, step: 0.5 },
  tbsp: { id: 'tbsp', label: 'tbsp', ml: 15, step: 0.5 },
  part: { id: 'part', label: 'part', plural: 'parts', step: 0.5, prefix: true },
  piece: { id: 'piece', label: 'piece', plural: 'pieces', step: 1, prefix: true },
  wedge: { id: 'wedge', label: 'wedge', plural: 'wedges', step: 1, prefix: true },
  slice: { id: 'slice', label: 'slice', plural: 'slices', step: 1, prefix: true },
  sprig: { id: 'sprig', label: 'sprig', plural: 'sprigs', step: 1, prefix: true },
  leaf: { id: 'leaf', label: 'leaf', plural: 'leaves', step: 1, prefix: true },
  pinch: { id: 'pinch', label: 'pinch', plural: 'pinches', step: 1, prefix: true },
  top: { id: 'top', label: 'top', step: 1, prefix: true },
  rinse: { id: 'rinse', label: 'rinse', step: 1, prefix: true },
  each: { id: 'each', label: '', step: 1, prefix: true },
  g: { id: 'g', label: 'g', ml: 1, step: 5 },
}

/** ordered list for unit pickers, volume units first */
export const UNIT_ORDER: Unit[] = [
  'oz', 'ml', 'cl', 'part', 'dash', 'barspoon', 'tsp', 'tbsp', 'drop',
  'piece', 'wedge', 'slice', 'sprig', 'leaf', 'pinch', 'top', 'rinse', 'g', 'each',
]

export function isConvertible(unit: Unit): boolean {
  return UNITS[unit].ml !== undefined
}

/**
 * Convert an amount between two convertible volume units. If either unit is
 * non-convertible (dash, part, wedge…) the amount is returned unchanged — you
 * never turn "1 dash" into oz.
 */
export function convert(amount: number, from: Unit, to: Unit): number {
  const fromDef = UNITS[from]
  const toDef = UNITS[to]
  if (fromDef.ml === undefined || toDef.ml === undefined) return amount
  return (amount * fromDef.ml) / toDef.ml
}

const VULGAR: Record<string, string> = {
  '0.25': '¼',
  '0.5': '½',
  '0.75': '¾',
  '0.33': '⅓',
  '0.67': '⅔',
  '0.2': '⅕',
  '0.125': '⅛',
  '0.375': '⅜',
  '0.625': '⅝',
  '0.875': '⅞',
}

/** Render a number, using vulgar fractions for the common bar quarters/thirds. */
export function formatNumber(value: number, unit: Unit): string {
  const rounded = Math.round(value * 1000) / 1000
  // ml/cl/g read better as plain decimals
  if (unit === 'ml' || unit === 'cl' || unit === 'g') {
    return trimZeros(Math.round(rounded * 10) / 10)
  }
  const whole = Math.floor(rounded)
  const frac = Math.round((rounded - whole) * 1000) / 1000
  const fracKey = nearestFractionKey(frac)
  if (fracKey) {
    const glyph = VULGAR[fracKey]
    return whole > 0 ? `${whole}${glyph}` : glyph
  }
  return trimZeros(rounded)
}

function nearestFractionKey(frac: number): string | null {
  if (frac === 0) return null
  let best: string | null = null
  let bestDist = 0.02 // tolerance
  for (const key of Object.keys(VULGAR)) {
    const dist = Math.abs(frac - Number(key))
    if (dist < bestDist) {
      bestDist = dist
      best = key
    }
  }
  return best
}

function trimZeros(n: number): string {
  return String(Number(n.toFixed(2)))
}

export type VolumePreference = 'oz' | 'ml'

/**
 * Convert the "main" volume units (oz/cl/ml) to the user's preferred unit.
 * Specialised units (dash, barspoon, part, wedge…) are left untouched — a
 * "2 dash" bitters line should never render as "0.05 oz".
 */
export function toPreferred(
  amount: number,
  unit: Unit,
  pref: VolumePreference,
): { amount: number; unit: Unit } {
  if (unit === 'oz' || unit === 'cl' || unit === 'ml') {
    return { amount: convert(amount, unit, pref), unit: pref }
  }
  return { amount, unit }
}

/** Pluralize + place the unit label for a rendered amount. */
export function formatAmount(amount: number | null, unit: Unit): string {
  const def = UNITS[unit]
  if (amount === null) {
    return def.label || ''
  }
  const num = formatNumber(amount, unit)
  const isPlural = amount !== 1 && amount !== -1
  const word = isPlural && def.plural ? def.plural : def.label
  if (!word) return num // e.g. "each" / bare count
  return def.prefix ? `${num} ${word}` : `${num} ${word}`
}
