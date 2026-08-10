import type { RecipeKind } from '../db/schema'

// Phase one of duplicate detection: find, locally, which recipes already in the
// library are worth ASKING about. Only the names that survive this pass are sent
// to the AI for a verdict, so the cloud sees a handful of strings rather than an
// index of everything the user owns.
//
// This pass is tuned for RECALL, not precision — a false candidate costs a few
// tokens in a prompt the model will reject; a missed one means a silent
// duplicate in the library. Deciding "same drink" vs "named riff" vs "shares a
// word" is the model's job, not this file's.

export interface NameIndexEntry {
  id: string
  name: string
  kind: RecipeKind
}

/**
 * Loose key for a *drink* name: lowercase, drop parentheticals and punctuation,
 * strip a leading article.
 *
 * Deliberately gentler than `normalizeComponentName()`, which also strips
 * rich/fresh/homemade. Those adjectives describe how a syrup was made and don't
 * change what it is; in a cocktail name a modifier word usually means a
 * genuinely different drink, so stripping them here would collapse drinks that
 * should stay apart.
 */
export function normalizeRecipeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(the|a|an)\s+/, '')
    .trim()
}

const tokensOf = (name: string): Set<string> => {
  const key = normalizeRecipeName(name)
  return new Set(key ? key.split(' ') : [])
}

const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((t) => b.has(t))

/**
 * 3 = same name, 2 = one name contains the other ("Daiquiri" / "Hemingway
 * Daiquiri" — the classic-and-its-riff case), 1 = heavy word overlap, 0 = no
 * relationship worth asking about.
 */
function score(a: string, b: string): number {
  const ka = normalizeRecipeName(a)
  const kb = normalizeRecipeName(b)
  if (!ka || !kb) return 0
  if (ka === kb) return 3

  const ta = tokensOf(a)
  const tb = tokensOf(b)
  if (isSubset(ta, tb) || isSubset(tb, ta)) return 2

  const shared = [...ta].filter((t) => tb.has(t)).length
  if (!shared) return 0
  const union = new Set([...ta, ...tb]).size
  return shared / union >= 0.5 ? 1 : 0
}

/**
 * Library entries that might be the same drink as `name` (or as one of its
 * `aka`s — that's what catches a Daiquiri pasted in as "Rum Sour"). Only entries
 * of the same kind are considered: a syrup is never a duplicate of a cocktail.
 */
export function shortlistCandidates(
  name: string,
  aka: string[],
  index: NameIndexEntry[],
  kind: RecipeKind = 'cocktail',
  limit = 3,
): NameIndexEntry[] {
  const queries = [name, ...aka].filter((q) => q.trim())
  if (!queries.length) return []

  const scored: { entry: NameIndexEntry; score: number; distance: number }[] = []
  for (const entry of index) {
    if (entry.kind !== kind) continue
    let best = 0
    for (const q of queries) best = Math.max(best, score(q, entry.name))
    if (best > 0) {
      scored.push({
        entry,
        score: best,
        // prefer the candidate closest in length — with "Daiquiri" in hand,
        // "Daiquiri" should outrank "Hemingway Daiquiri" for the one slot.
        distance: Math.abs(tokensOf(entry.name).size - tokensOf(name).size),
      })
    }
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score || a.distance - b.distance || a.entry.name.localeCompare(b.entry.name),
    )
    .slice(0, limit)
    .map((s) => s.entry)
}
