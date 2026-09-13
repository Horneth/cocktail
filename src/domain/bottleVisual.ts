// What a bottle looks like on My Bar — and where its photo lives.
//
// Bottle portraits are keyed by the bottle's NAME, not its family: Campari,
// Aperol, Green Chartreuse and Kahlúa are all "liqueur"-ish, and a family
// portrait makes four different bottles look identical. So the primary visual
// is a per-bottle portrait — `public/bottles/b/<slug>.webp`, content-addressed
// by the same slug rules as the drink pool (`poolKey.mjs`: case-, punctuation-
// and diacritic-insensitive) — generated on demand by
// scripts/make-bottle-images.mjs for whatever bottle the user asks for.
//
// The per-CATEGORY portrait (`bottles/<category>.webp`, the generic unbranded
// studio bottle) is the FALLBACK for a bottle that has no portrait yet —
// correct for the family even when it isn't the actual bottle. `BottleArt`
// walks name portrait → category portrait → drawn glyph via its onError chain.
//
// Syrups are never photographed: their identity IS the liquid colour (see
// syrupArt.ts), which a generic syrup photo would erase. BottleArt branches
// them out before this map is consulted.

import { slugifyPoolKey } from './poolKey.mjs'

// Category portraits, one per real bottle family. Non-ASCII keys get an ASCII
// filename ("cachaça" → cachaca.webp) so URLs never need escaping. 'other' is
// the neutral portrait for anything uncategorised or custom — the shelf's
// floor, so no card ever falls through to a bare glyph.
const CATEGORY_FILES: Record<string, string> = {
  gin: 'gin',
  vodka: 'vodka',
  rum: 'rum',
  'cachaça': 'cachaca',
  whiskey: 'whiskey',
  tequila: 'tequila',
  mezcal: 'mezcal',
  agave: 'agave',
  brandy: 'brandy',
  cognac: 'cognac',
  pisco: 'pisco',
  wine: 'wine',
  aperitivo: 'aperitivo',
  liqueur: 'liqueur',
  other: 'other',
}

/** Every category key that has a generic portrait — the generator's job list. */
export const BOTTLE_IMAGE_CATEGORIES: readonly string[] = Object.keys(CATEGORY_FILES)

/**
 * Spelling variants that resolve to one portrait. The file is named for the
 * canonical bottle ("green-chartreuse.webp"); a shelf may spell it differently
 * ("Chartreuse Verte") and still find it. Slugs are pool-slug rules, so a
 * library phrasing ("Aperitivo (Campari)") resolves to the same file as the
 * plain name. Slug → canonical slug.
 */
const ALIASES: Record<string, string> = {
  'chartreuse-verte': 'green-chartreuse',
  'green-chartreuse-liqueur': 'green-chartreuse',
  'aperitivo-campari': 'campari',
  curacao: 'orange-curacao',
  'blackberry-liqueur-chambord': 'chambord',
  'absinthe-rinse': 'absinthe',
  bitters: 'angostura-bitters',
  'club-soda': 'soda-water',
  seltzer: 'soda-water',
  'sparkling-water': 'soda-water',
  coke: 'cola',
}

/** The generic studio portrait for a category, or undefined when none exists. */
export function categoryPortraitFor(category: string | undefined): string | undefined {
  const file = category ? CATEGORY_FILES[category] : undefined
  return file ? `${import.meta.env.BASE_URL}bottles/${file}.webp` : undefined
}

/**
 * The name-keyed portrait for this exact bottle, or undefined when the label
 * is unusable. Optimistic: the file may not exist (never generated), which the
 * <img>'s onError handles by stepping to the category portrait.
 */
export function bottlePortraitFor(label: string): string | undefined {
  const slug = slugifyPoolKey(label)
  if (!slug) return undefined
  return `${import.meta.env.BASE_URL}bottles/b/${ALIASES[slug] ?? slug}.webp`
}