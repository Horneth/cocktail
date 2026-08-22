// The pre-generated cocktail image catalog.
//
// Each entry is a curated photo slot: a glass + style + garnish combination that
// covers a family of similar drinks. The recipe editor suggests the closest slots
// for a drink being built; the generation script (`scripts/generate-images.mjs`)
// renders these slots (your own Gemini key, outside Firebase AI Logic, so the
// project's template-only mode doesn't block it) into `public/images/cocktails/`,
// and the app serves them from the Firebase Storage CDN with a bundled fallback.
//
// The DATA lives in `recipeImages.json` — the single source of truth shared by
// the generator, the matcher, and the app's manifest merge. This file only adds
// the types and the glass classifier. To add a new style: append a row to
// `recipeImages.json` (copy one, change slug/glass/keywords/cue/sample), then
// run `npm run images -- --only <slug>` and publish to Storage. No app redeploy
// is needed for a *new slot* because the app merges a Storage-hosted manifest
// over this bundled catalog at boot.

import catalog from './recipeImages.json'

export type ImageGlassKind =
  | 'coupe'
  | 'nickandnora'
  | 'martini'
  | 'rocks'
  | 'highball'
  | 'collins'
  | 'tiki'
  | 'copper'
  | 'flute'
  | 'julep'
  | 'shot'
  | 'frozen'
  | 'snifter'
  | 'wine'

export interface CocktailImage {
  /** url slug + file name, e.g. 'sour-straw' -> sour-straw.webp */
  slug: string
  /** short label shown in the editor's suggested picks (e.g. "Sour / pale") */
  label: string
  /** free-text recipe description (glass + style + appearance) */
  description: string
  /** which canonical scene/glass the shot renders around */
  glass: ImageGlassKind
  /** words the matcher uses to score this slot against a recipe */
  keywords: string[]
  /** a sample recipe this slot is the canonical look for */
  sample: string
  /** fixed visual cues used by the generator (colors, garnish) */
  cue: string
}

/** Catalog of curated cocktail photos. Ordered roughly by how common the look is. */
export const IMAGE_CATALOG: CocktailImage[] = catalog as CocktailImage[]

/** Map a glass name to an `ImageGlassKind` (or null when unknown). */
export function glassKind(label: string | undefined): ImageGlassKind | null {
  const g = (label ?? '').toLowerCase()
  if (/nick|nora|martini|coupe/.test(g)) {
    return /martini/.test(g) ? 'martini' : 'coupe'
  }
  if (/rocks|old fashioned|tumbler|lowball/i.test(g)) return 'rocks'
  if (/highball|collins|tall/i.test(g)) return /collins/i.test(g) ? 'collins' : 'highball'
  if (/copper|mug|tiki|pineapple|hurricane|zombie/i.test(g)) return 'tiki'
  if (/flute/i.test(g)) return 'flute'
  if (/frozen|blended|slush/i.test(g)) return 'frozen'
  if (/julep|silver cup/i.test(g)) return 'julep'
  if (/shot|shooter/i.test(g)) return 'shot'
  if (/snifter|champagne?glass|brandy/i.test(g)) return 'snifter'
  return null
}