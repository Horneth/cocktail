// The soft vocabularies the app agrees on: tags, build methods, glassware.
//
// These used to live in three places that disagreed with each other — the AI
// prompt suggested tags like "shaken"/"boozy"/"dry" that Browse has no glyph for
// and nobody filters by, while Browse's own list offered "bubbly"/"nightcap"/
// "smoky" that the model was never told about. One list, imported by the prompt,
// the editor and the import preview alike, keeps them from drifting again.
//
// They stay SOFT: the DB fields are free strings (same posture as the open
// `SpiritCategory`), so a recipe can carry a tag or a glass we never listed. The
// vocabulary steers the model and populates the pickers; it never rejects.

/** Tag → leading glyph. Order is the order they're offered in the import picker. */
export const TAGS: Record<string, string> = {
  classic: '🎩',
  sour: '🍋',
  citrusy: '🍊',
  refreshing: '💧',
  'spirit-forward': '🥃',
  bitter: '🌿',
  bubbly: '🫧',
  herbal: '🌱',
  sweet: '🍬',
  nightcap: '🌙',
  'low-abv': '🍃',
  tropical: '🏝️',
  smoky: '💨',
  creamy: '🥛',
  fruity: '🍓',
  brunch: '🥂',
  spicy: '🌶️',
  frozen: '🧊',
  tiki: '🗿',
  syrup: '🧪',
}

export const TAG_KEYS = Object.keys(TAGS)

/** Glyph for a tag, with a generic fallback for user/AI-invented ones. */
export const tagEmoji = (t: string): string => TAGS[t] ?? '🏷️'

/** Distinct tags across a library, in vocabulary order first (so the filter row
 * never shuffles), then unknown ones alphabetically. Tags are normalized
 * lowercase — stored tags may carry arbitrary casing (the editor doesn't
 * normalize), the AI importer does. */
export function libraryTags(recipes: { tags: string[] }[]): string[] {
  const present = new Set(
    recipes.flatMap((r) => r.tags.map((t) => t.trim().toLowerCase())).filter(Boolean),
  )
  const known = TAG_KEYS.filter((t) => present.has(t))
  const extras = [...present].filter((t) => !TAG_KEYS.includes(t)).sort()
  return [...known, ...extras]
}

/** A recipe matches when it carries every selected tag (case-insensitive). */
export function matchesTags(recipe: { tags: string[] }, selected: readonly string[]): boolean {
  const own = new Set(recipe.tags.map((t) => t.trim().toLowerCase()))
  return selected.every((t) => own.has(t.toLowerCase()))
}

export const METHODS = ['Shake', 'Stir', 'Build', 'Blend', 'Throw', 'Swizzle']

export const GLASSES = [
  'Coupe',
  'Rocks',
  'Highball',
  'Collins',
  'Nick & Nora',
  'Martini',
  'Flute',
  'Wine',
  'Tiki mug',
  'Julep tin',
  'Mug',
  'Shot',
]

/**
 * Snap a model- or user-supplied value onto a vocabulary entry when it matches
 * case-insensitively ("shake" → "Shake"), otherwise keep it verbatim. Casing is
 * the only thing normalized — an unlisted glass ("Copper mug") passes through so
 * the vocabulary never silently drops information.
 */
export function canonical(value: string | undefined, list: string[]): string | undefined {
  const v = value?.trim()
  if (!v) return undefined
  return list.find((entry) => entry.toLowerCase() === v.toLowerCase()) ?? v
}
