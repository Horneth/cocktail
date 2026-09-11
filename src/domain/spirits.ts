import type { Recipe } from '../db/schema'

export interface TileMeta {
  key: string
  label: string
  emoji: string
  gradient: string
}

interface KnownMeta {
  label: string
  emoji: string
  gradient: string
}

// Metadata for the spirits we ship art for. Any spirit not listed here still
// gets its own tile via generated art (see tileMeta).
const KNOWN: Record<string, KnownMeta> = {
  gin: { label: 'Gin', emoji: '🍸', gradient: 'linear-gradient(145deg,#2f7d74,#123a3d)' },
  vodka: { label: 'Vodka', emoji: '🧊', gradient: 'linear-gradient(145deg,#4a72ad,#1f3559)' },
  rum: { label: 'Rum', emoji: '🥃', gradient: 'linear-gradient(145deg,#c07f3c,#5f3312)' },
  cachaça: { label: 'Cachaça', emoji: '🌿', gradient: 'linear-gradient(145deg,#7ba13f,#39511d)' },
  whiskey: { label: 'Whiskey', emoji: '🥃', gradient: 'linear-gradient(145deg,#a85a29,#45210e)' },
  tequila: { label: 'Tequila', emoji: '🌵', gradient: 'linear-gradient(145deg,#84a84f,#39501f)' },
  mezcal: { label: 'Mezcal', emoji: '🔥', gradient: 'linear-gradient(145deg,#a5623a,#4a2a17)' },
  agave: { label: 'Agave', emoji: '🪅', gradient: 'linear-gradient(145deg,#6f7f3a,#33411b)' },
  brandy: { label: 'Brandy', emoji: '🍇', gradient: 'linear-gradient(145deg,#b25f38,#5a2914)' },
  cognac: { label: 'Cognac', emoji: '🥃', gradient: 'linear-gradient(145deg,#b06a34,#552812)' },
  pisco: { label: 'Pisco', emoji: '🍇', gradient: 'linear-gradient(145deg,#9c7a4a,#463315)' },
  wine: { label: 'Wine & bubbles', emoji: '🍷', gradient: 'linear-gradient(145deg,#9a3a55,#4a1a28)' },
  liqueur: { label: 'Liqueur', emoji: '🍶', gradient: 'linear-gradient(145deg,#9c4d90,#48203f)' },
  aperitivo: { label: 'Aperitivo', emoji: '🍊', gradient: 'linear-gradient(145deg,#d4703f,#7a2e18)' },
  mocktail: { label: 'Mocktails', emoji: '🍹', gradient: 'linear-gradient(145deg,#3f9f6a,#175236)' },
  syrup: { label: 'Syrups', emoji: '🍯', gradient: 'linear-gradient(145deg,#c0813e,#5f3312)' },
  cordial: { label: 'Cordials', emoji: '🍷', gradient: 'linear-gradient(145deg,#9c4d90,#48203f)' },
  other: { label: 'Other', emoji: '🍸', gradient: 'linear-gradient(145deg,#6b5f77,#332a3d)' },
}

/** Display order for known spirits on the mosaic; custom spirits follow. */
export const SPIRIT_ORDER = [
  'gin', 'vodka', 'rum', 'cachaça', 'whiskey', 'tequila', 'mezcal', 'agave',
  'brandy', 'cognac', 'pisco', 'wine', 'aperitivo', 'liqueur', 'mocktail', 'other',
]

/** Suggestions for the spirit input (users can still type anything else). */
export const KNOWN_SPIRITS = SPIRIT_ORDER.filter((k) => k !== 'other')

const SPECIAL: Record<string, TileMeta> = {
  all: { key: 'all', label: 'All cocktails', emoji: '🍸', gradient: 'linear-gradient(145deg,#5b4a6b,#2a2233)' },
  favorites: { key: 'favorites', label: 'Favorites', emoji: '❤️', gradient: 'linear-gradient(145deg,#b64a5a,#5a1f2a)' },
}

function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

/** A deterministic, on-brand gradient for a custom spirit name. */
function generatedGradient(key: string): string {
  const h = hashHue(key)
  return `linear-gradient(145deg,hsl(${h},42%,38%),hsl(${h},48%,18%))`
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Which mosaic tile a recipe belongs to. A mixer's kind is its tile; a drink's
 * spirit is its tile. */
export function tileKeyForRecipe(r: Recipe): string {
  if (r.kind === 'syrup') return 'syrup'
  if (r.kind === 'cordial') return 'cordial'
  const s = r.spirit?.trim().toLowerCase()
  return s && s !== 'none' ? s : 'other'
}

/** Metadata for a tile key — special, known, or a generated custom spirit. */
export function tileMeta(key: string): TileMeta {
  if (SPECIAL[key]) return SPECIAL[key]
  const known = KNOWN[key]
  if (known) return { key, ...known }
  return { key, label: cap(key), emoji: '🍾', gradient: generatedGradient(key) }
}

/** Sort index for a spirit tile key (known order first, then alphabetical). */
export function spiritSortIndex(key: string): number {
  const i = SPIRIT_ORDER.indexOf(key)
  return i === -1 ? SPIRIT_ORDER.length : i
}
