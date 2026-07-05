import type { Recipe } from '../db/schema'

export interface TileMeta {
  key: string
  label: string
  emoji: string
  gradient: string
}

// Base-spirit tiles shown on the home mosaic. Each has a distinct emoji + hue.
export const SPIRIT_TILES: TileMeta[] = [
  { key: 'gin', label: 'Gin', emoji: '🍸', gradient: 'linear-gradient(145deg,#2f7d74,#123a3d)' },
  { key: 'vodka', label: 'Vodka', emoji: '🧊', gradient: 'linear-gradient(145deg,#4a72ad,#1f3559)' },
  { key: 'rum', label: 'Rum', emoji: '🥃', gradient: 'linear-gradient(145deg,#c07f3c,#5f3312)' },
  { key: 'whiskey', label: 'Whiskey', emoji: '🥃', gradient: 'linear-gradient(145deg,#a85a29,#45210e)' },
  { key: 'tequila', label: 'Tequila', emoji: '🌵', gradient: 'linear-gradient(145deg,#84a84f,#39501f)' },
  { key: 'agave', label: 'Mezcal & agave', emoji: '🪅', gradient: 'linear-gradient(145deg,#6f7f3a,#33411b)' },
  { key: 'brandy', label: 'Brandy', emoji: '🍇', gradient: 'linear-gradient(145deg,#b25f38,#5a2914)' },
  { key: 'liqueur', label: 'Liqueur', emoji: '🍶', gradient: 'linear-gradient(145deg,#9c4d90,#48203f)' },
  { key: 'wine', label: 'Wine & bubbles', emoji: '🍷', gradient: 'linear-gradient(145deg,#9a3a55,#4a1a28)' },
  { key: 'mocktail', label: 'Mocktails', emoji: '🍹', gradient: 'linear-gradient(145deg,#3f9f6a,#175236)' },
  { key: 'other', label: 'Other', emoji: '🍸', gradient: 'linear-gradient(145deg,#6b5f77,#332a3d)' },
]

const KNOWN = new Set(SPIRIT_TILES.map((t) => t.key).filter((k) => k !== 'other'))

/** Which mosaic tile a cocktail belongs to (unknown/none/other collapse to "other"). */
export function tileKeyForRecipe(r: Recipe): string {
  return r.spirit && KNOWN.has(r.spirit) ? r.spirit : 'other'
}

const SPECIAL: Record<string, TileMeta> = {
  all: { key: 'all', label: 'All cocktails', emoji: '🍸', gradient: 'linear-gradient(145deg,#5b4a6b,#2a2233)' },
  favorites: { key: 'favorites', label: 'Favorites', emoji: '❤️', gradient: 'linear-gradient(145deg,#b64a5a,#5a1f2a)' },
  components: { key: 'components', label: 'Syrups & more', emoji: '🧪', gradient: 'linear-gradient(145deg,#3f7d8a,#1c3a45)' },
}

export function tileMeta(key: string): TileMeta {
  return SPECIAL[key] ?? SPIRIT_TILES.find((t) => t.key === key) ?? SPECIAL.all
}
