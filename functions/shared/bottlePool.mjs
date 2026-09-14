import { slugifyPoolKey } from './poolKey.mjs'

const PORT_VARIANTS = /\b(tawny|ruby)\b/g
const CHARTREUSE_VARIANTS = {
  verte: 'green',
  jaune: 'yellow',
}

function canonicalBottleName(name) {
  let value = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/\bport\b/.test(value)) value = value.replace(PORT_VARIANTS, ' ')
  if (/\bchartreuse\b/.test(value)) {
    for (const [from, to] of Object.entries(CHARTREUSE_VARIANTS)) {
      value = value.replace(new RegExp(`\\b${from}\\b`, 'g'), to)
    }
    value = value.replace(/\bchartreuse (green|yellow)\b/, '$1 chartreuse')
  }
  return value.replace(/\s+/g, ' ').trim()
}

export function bottlePoolKeyFor(name, category) {
  const cleanName = canonicalBottleName(String(name ?? ''))
  const cleanCategory = category ? canonicalBottleName(category) : ''
  return slugifyPoolKey([cleanCategory, cleanName].filter(Boolean).join('-'))
}

export function bottlePoolPath(key) {
  return `bottles/v1/${key}.webp`
}

export function sanitizeBottleName(name) {
  return String(name ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[`*_~#[\]{}<>|\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim()
}
