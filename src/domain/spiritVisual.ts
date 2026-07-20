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
  // special tiles
  all: { tint: '#F1ECE3', dot: '#8C857B' },
  favorites: { tint: '#F7E7E2', dot: '#E7623B' },
  components: { tint: '#F5EEDF', dot: '#C0813E' },
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
  return { key, label: meta.label, emoji: meta.emoji, tint: c.tint, dot: c.dot }
}
