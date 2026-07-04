import type { Ingredient, MeasureBasis, Unit } from '../db/schema'

// View-time scaling. NOTHING here mutates stored data. The detail screen holds
// the target servings / per-part volume as UI state and asks for a display
// amount per ingredient.

export interface ScaleSettings {
  measureBasis: MeasureBasis
  baseServings: number
  targetServings: number
  /** parts recipes: volume in ml assigned to 1 part. undefined => show raw ratio */
  mlPerPart?: number
}

export interface DisplayAmount {
  amount: number | null
  unit: Unit
}

/** Multiplier applied to absolute-basis amounts. Parts recipes don't use it. */
export function scaleFactor(s: ScaleSettings): number {
  if (s.measureBasis === 'parts') return 1
  if (!s.baseServings) return 1
  return s.targetServings / s.baseServings
}

/**
 * Resolve the display amount for one ingredient.
 * `override` is the user's transient inline nudge — an absolute amount in the
 * ingredient's own unit that replaces the computed value (never persisted here).
 */
export function scaledIngredient(
  ing: Ingredient,
  s: ScaleSettings,
  override?: number | null,
): DisplayAmount {
  if (override !== undefined && override !== null) {
    return { amount: override, unit: ing.unit }
  }
  if (ing.amount === null) return { amount: null, unit: ing.unit }

  // Parts recipes: multiply the ratio by the chosen per-part volume, if any.
  if (s.measureBasis === 'parts' && ing.unit === 'part') {
    if (s.mlPerPart && s.mlPerPart > 0) {
      return { amount: ing.amount * s.mlPerPart, unit: 'ml' }
    }
    return { amount: ing.amount, unit: 'part' }
  }

  return { amount: ing.amount * scaleFactor(s), unit: ing.unit }
}
