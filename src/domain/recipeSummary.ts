import type { Recipe } from '../db/schema'
import { formatAmount } from './units'

/** A one-line ingredient summary for list cards. */
export function summarize(r: Recipe): string {
  if (r.kind !== 'cocktail' && r.measureBasis === 'parts') {
    return r.ingredients
      .map((i) => (i.amount !== null ? formatAmount(i.amount, i.unit) : i.name))
      .join(' : ')
  }
  const named = r.ingredients.filter((i) => !i.optional)
  const shown = named.slice(0, 3).map((i) => i.name)
  const extra = named.length - shown.length
  const base = shown.join(' · ')
  return extra > 0 ? `${base} +${extra}` : base
}
