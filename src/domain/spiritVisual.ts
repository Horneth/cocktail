import { tileMeta } from './spirits'

/**
 * Visual tokens for a spirit / tile key in the Nightcap redesign: a soft "tint"
 * card background paired with a saturated "dot" accent, plus the emoji + label
 * (reused from `tileMeta` so custom spirits still get their generated glyph).
 *
 * This is presentation-only styling data — no React, no DB — so it lives beside
 * the other pure spirit metadata in `domain/`.
 */
export interface SpiritVisual {
  key: string
  label: string
  emoji: string
  tint: string
  dot: string
  /** Which bottle silhouette to draw for this category (see BOTTLE_PATHS). */
  silhouette: BottleShape
}

/** Solid bottle silhouettes, one per family look. Viewbox 0 0 24 24, filled
 * with the category's `dot` colour — a shape is a family resemblance (bourbon
 * and rye are both square-shouldered), the tint is what separates them. */
export type BottleShape =
  | 'tall' // slim straight bottle, long neck — gin, vodka, pisco, cachaça
  | 'square' // square shoulders, broad body — whiskey
  | 'round' // round shoulders — rum, agave
  | 'wine' // long sloped shoulders, thin neck — wine & fortified
  | 'squat' // short neck flaring into a wide body — tequila, mezcal
  | 'decanter' // very short neck, very wide body — brandy, cognac
  | 'liqueur' // flared shoulders, medium body — liqueurs & cordials
  | 'jar' // wide cap over a squat body — syrups
  | 'generic' // anything else (unknown/custom categories)

// Ordered so shared shapes stay in sync with the type above; `spiritVisual`
// maps every category key onto one of these.
export const BOTTLE_SHAPES: readonly BottleShape[] = [
  'tall', 'square', 'round', 'wine', 'squat', 'decanter', 'liqueur', 'jar', 'generic',
]

// Bottle outlines, one closed path per shape, drawn as a silhouette (cap →
// neck → shoulders → body → base), all symmetric about x=12. The mirror-side
// cubics are the exact reflection of the right-side ones, so each silhouette
// stays balanced — verified by the screenshot preview and the bounds test.
export const BOTTLE_PATHS: Record<BottleShape, string> = {
  tall:
    'M10.8 1.6 h2.4 v1.7 h-0.4 v4.2 c0.4 1.2 1.2 2.2 2.9 4 v7.9 a2.2 2.2 0 0 1 -2.2 2.2 h-3 a2.2 2.2 0 0 1 -2.2 -2.2 v-7.9 c1.7 -1.8 2.5 -2.8 2.9 -4 v-4.2 h-0.4 z',
  square:
    'M10.5 1.6 h3 v1.9 h-0.3 v1.4 c1.9 0 3.5 0.3 3.8 2.2 v12.3 a1.9 1.9 0 0 1 -1.9 1.9 h-6.2 a1.9 1.9 0 0 1 -1.9 -1.9 v-12.3 c0.3 -1.9 1.9 -2.2 3.8 -2.2 v-1.4 h-0.3 z',
  round:
    'M10.7 1.6 h2.6 v1.7 h-0.3 v2.8 c0.2 0.6 0.5 1 1 1.6 c1.6 1.5 2.7 2.4 2.7 4.4 v7 a2.3 2.3 0 0 1 -2.3 2.3 h-4.8 a2.3 2.3 0 0 1 -2.3 -2.3 v-7 c0 -2 1.1 -2.9 2.7 -4.4 c0.5 -0.6 0.8 -1 1 -1.6 v-2.8 h-0.3 z',
  wine:
    'M11 1.6 h2 v1.6 h-0.2 v2.6 c0.4 0.8 0.8 1.2 1.2 1.8 c2 2.2 3.1 3.2 3.1 5.8 v6 a2 2 0 0 1 -2 2 h-6.2 a2 2 0 0 1 -2 -2 v-6 c0 -2.6 1.1 -3.6 3.1 -5.8 c0.4 -0.6 0.8 -1 1.2 -1.8 v-2.6 h-0.2 z',
  squat:
    'M10.5 1.6 h3 v1.9 h-0.4 v1.6 c0.3 1.6 1.5 3.4 4.4 5.3 v7.7 a2.5 2.5 0 0 1 -2.5 2.5 h-6 a2.5 2.5 0 0 1 -2.5 -2.5 v-7.7 c2.9 -1.9 4.1 -3.7 4.4 -5.3 v-1.6 h-0.4 z',
  decanter:
    'M10 1.8 h4 v2 h-0.6 v0.9 c0 0.5 0.2 0.7 0.7 0.9 c2.3 1 3.5 2.2 3.5 4.5 v6.6 a2.6 2.6 0 0 1 -2.6 2.6 h-6 a2.6 2.6 0 0 1 -2.6 -2.6 v-6.6 c0 -2.3 1.2 -3.5 3.5 -4.5 c0.5 -0.2 0.7 -0.4 0.7 -0.9 v-0.9 h-0.6 z',
  liqueur:
    'M10.6 1.8 h2.8 v1.7 h-0.4 v2.4 c0.3 0.8 1.5 2.2 3.4 5 v7.9 a2.2 2.2 0 0 1 -2.2 2.2 h-4.4 a2.2 2.2 0 0 1 -2.2 -2.2 v-7.9 c1.9 -2.8 3.1 -4.2 3.4 -5 v-2.4 h-0.4 z',
  jar:
    'M9.5 1.6 h5 v2.6 h-0.5 v1.2 c0.1 0.6 0.9 1.4 2 2.6 v10.2 a2.2 2.2 0 0 1 -2.2 2.2 h-3.6 a2.2 2.2 0 0 1 -2.2 -2.2 v-10.2 c1.1 -1.2 1.9 -2 2 -2.6 v-1.2 h-0.5 z',
  generic:
    'M10.6 2 h2.8 v1.7 h-0.6 v3 c0.3 0.8 1.2 1.8 2.8 3.9 v8.6 a2.2 2.2 0 0 1 -2.2 2.2 h-2.8 a2.2 2.2 0 0 1 -2.2 -2.2 v-8.6 c1.6 -2.1 2.5 -3.1 2.8 -3.9 v-3 h-0.6 z',
}

// Which family silhouette a category borrows. Several categories share a
// bottle look on purpose — the tint carries the distinction.
export const SHAPE_FOR: Record<string, BottleShape> = {
  gin: 'tall', vodka: 'tall', pisco: 'tall', 'cachaça': 'tall', mocktail: 'tall',
  whiskey: 'square',
  rum: 'round', agave: 'round',
  wine: 'wine',
  tequila: 'squat', mezcal: 'squat',
  brandy: 'decanter', cognac: 'decanter',
  liqueur: 'liqueur', aperitivo: 'liqueur',
  syrup: 'jar',
  // 'other' and unknown custom spirits fall through to 'generic'
}

// Hand-tuned pairs from the design tokens; extended to cover every key the app
// can produce (see SPIRIT_ORDER in spirits.ts) so no known spirit falls back.
const TINTS: Record<string, { tint: string; dot: string }> = {
  gin: { tint: '#E9F1EB', dot: '#4E9E7E' },
  whiskey: { tint: '#F4E9DD', dot: '#B06A34' },
  rum: { tint: '#F5EBDC', dot: '#C0813E' },
  tequila: { tint: '#EFF2E2', dot: '#7E9A4A' },
  vodka: { tint: '#E7EEF6', dot: '#5A7FB0' },
  mezcal: { tint: '#F2E9E2', dot: '#A5623A' },
  agave: { tint: '#EFF2E2', dot: '#7E9A4A' },
  cachaça: { tint: '#EDF1E6', dot: '#6E9A54' },
  brandy: { tint: '#F4E7DC', dot: '#B0662E' },
  cognac: { tint: '#F4E7DC', dot: '#A85B2C' },
  pisco: { tint: '#F5EEDD', dot: '#C09A44' },
  wine: { tint: '#F3E6E8', dot: '#A6516A' },
  liqueur: { tint: '#F6E9E0', dot: '#D06A3A' },
  aperitivo: { tint: '#F6E9E0', dot: '#D06A3A' },
  mocktail: { tint: '#E9F0F1', dot: '#559196' },
  syrup: { tint: '#F5EEDF', dot: '#C0813E' },
  // special tiles
  all: { tint: '#F1ECE3', dot: '#8C857B' },
  favorites: { tint: '#F7E7E2', dot: '#E7623B' },
  other: { tint: '#F1ECE3', dot: '#8C857B' },
}

// Deterministic soft tint for an unknown custom spirit — a low-saturation card
// background plus a readable accent, both derived from the key's hash so the
// same spirit always gets the same colour without a code change.
function generated(key: string): { tint: string; dot: string } {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  const hue = h % 360
  return {
    tint: `hsl(${hue} 32% 93%)`,
    dot: `hsl(${hue} 42% 45%)`,
  }
}

export function spiritVisual(key: string): SpiritVisual {
  const meta = tileMeta(key)
  const c = TINTS[key] ?? generated(key)
  return { key, label: meta.label, emoji: meta.emoji, tint: c.tint, dot: c.dot, silhouette: SHAPE_FOR[key] ?? 'generic' }
}
