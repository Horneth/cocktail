import type { Recipe } from '../db/schema'

// Loose name key for matching *mixer* (syrup) names and for the
// merge-duplicates tool. It strips ratio parentheticals ("(1.5:1)") and the
// "richness" adjectives that distinguish otherwise-identical syrups, so
// "Semi-Rich Simple Syrup" and "Simple Syrup" collapse to the same key.
//
// This is DELIBERATELY different from `availability.normIngredient`, which keeps
// brand/origin words ("jamaican rum") because bottle matching needs them. Keep
// the two separate: loosening this one must never loosen ingredient matching.
export function normalizeMixerName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, '') // drop "(1.5:1)" / "(2:1)"
    // richness / prep adjectives that distinguish otherwise-identical syrups.
    // `semi` is stripped on its own so "Semi Rich Simple Syrup" (spaces, as most
    // imports write it) collapses the same as the hyphenated "Semi-Rich".
    .replace(/\b(semi-?rich|semi|rich|fresh|homemade|cold|hot|pure)\b/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Group mixers whose normalized names collide — i.e. likely duplicates the user
 * may want to merge (e.g. a hand-added "Simple Syrup" and an imported
 * "Semi Rich Simple Syrup"). Only groups of 2+ are returned. Within each group
 * the recipes keep their given order (caller decides which is canonical).
 */
export function duplicateMixerGroups(mixers: Recipe[]): Recipe[][] {
  const byKey = new Map<string, Recipe[]>()
  for (const m of mixers) {
    const key = normalizeMixerName(m.name)
    if (!key) continue
    const group = byKey.get(key)
    if (group) group.push(m)
    else byKey.set(key, [m])
  }
  return [...byKey.values()].filter((g) => g.length >= 2)
}
