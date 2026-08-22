import type { PantryItem } from '../db/schema'
import { normIngredient } from './availability'
import { categoryForName } from './spiritCategory'

// Local near-duplicate detection for the shelf scan. This is the half of the
// two-pass dedupe that runs on-device: it decides which of the user's bottles
// are even worth asking the model about, so pass 2 sends a handful of names
// instead of the whole inventory (and is skipped entirely when nothing is
// close). Scoring is intentionally lexical — deciding whether "Tanqueray No.
// Ten" IS "Tanqueray" is a judgement call, and that's what the model is for.
//
// Kept separate from `normalizeMixerName` for the reason spelled out in
// textNormalize.ts: these keys must never converge.

export interface BottleCandidate {
  /** normalized key of the existing bottle */
  name: string
  /** its display label, which is what we show and what we send to the model */
  label: string
  /** 0–1, higher is more alike */
  score: number
}

export type Verdict = 'same' | 'variant' | 'new'

export interface LocalMatch {
  verdict: Verdict
  /** the existing bottle's label, when the verdict points at one */
  match?: string
  /** the shortlist worth sending to the model, best first */
  candidates: BottleCandidate[]
}

// Bottles write the same number both ways ("Plantation 3 Stars" / "Plantation
// Three Stars"), so fold them together before comparing.
const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6',
  seven: '7', eight: '8', nine: '9', ten: '10', eleven: '11', twelve: '12',
}

// Glue that carries no identity. "no" matters: "Tanqueray No. Ten" normalizes
// to "tanqueray no ten", and the "no" would otherwise inflate every match
// against another "No." bottle.
const GLUE = new Set(['the', 'a', 'an', 'of', 'and', 'de', 'no'])

function tokens(name: string): string[] {
  return normIngredient(name)
    .split(' ')
    .map((t) => NUMBER_WORDS[t] ?? t)
    .filter((t) => t && !GLUE.has(t))
}

/**
 * How alike two bottle names read, 0–1. Blends Dice (rewards agreeing on most of
 * both names) with the overlap coefficient (forgives one name being longer, so
 * "Tanqueray" still scores against "Tanqueray No. Ten").
 */
export function similarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.length || !tb.length) return 0
  const setB = new Set(tb)
  const shared = new Set(ta.filter((t) => setB.has(t))).size
  if (!shared) return 0
  const dice = (2 * shared) / (ta.length + tb.length)
  const overlap = shared / Math.min(ta.length, tb.length)
  return (dice + overlap) / 2
}

/** Below this two names have nothing meaningful in common. */
const MIN_SCORE = 0.34
/** At or above this we'd call it a variant ourselves if the model can't answer. */
export const VARIANT_SCORE = 0.6
/** Agreeing on the base spirit is corroboration, not evidence on its own. */
const CATEGORY_BONUS = 0.12

/** The already-stocked bottle this detection is literally the same string as. */
export function exactMatch(detected: string, existing: PantryItem[]): PantryItem | undefined {
  const key = normIngredient(detected)
  return key ? existing.find((item) => item.name === key) : undefined
}

/**
 * The few existing bottles worth asking the model about. Requires real token
 * overlap — a matching category alone never makes two bottles candidates, or
 * every gin would be a candidate for every other gin.
 */
export function closeCandidates(
  detected: { name: string; category?: string },
  existing: PantryItem[],
  limit = 5,
): BottleCandidate[] {
  const detectedCategory = detected.category ?? categoryForName(detected.name)
  const out: BottleCandidate[] = []
  for (const item of existing) {
    const base = similarity(detected.name, item.label)
    if (base <= 0) continue
    const category = item.category ?? categoryForName(item.label)
    const score = Math.min(1, base + (category && category === detectedCategory ? CATEGORY_BONUS : 0))
    if (score < MIN_SCORE) continue
    out.push({ name: item.name, label: item.label, score })
  }
  return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit)
}

/**
 * The on-device verdict: exact string match is decided here, everything else is
 * a shortlist for the model. Also the fallback when the reconcile call fails —
 * the scan must still work when the second AI pass doesn't.
 */
export function localMatch(
  detected: { name: string; category?: string },
  existing: PantryItem[],
  limit = 5,
): LocalMatch {
  const exact = exactMatch(detected.name, existing)
  if (exact) return { verdict: 'same', match: exact.label, candidates: [] }

  const candidates = closeCandidates(detected, existing, limit)
  const top = candidates[0]
  if (top && top.score >= VARIANT_SCORE) {
    return { verdict: 'variant', match: top.label, candidates }
  }
  return { verdict: 'new', candidates }
}

/** A model verdict, structurally — kept local so domain/ doesn't depend on import/. */
export interface ReconciledVerdict {
  detected: string
  verdict: Verdict
  match?: string
  canonicalName?: string
}

export interface ResolvedBottle<T> {
  detected: T
  verdict: Verdict
  /** the existing bottle this duplicates or varies from */
  match?: string
  /** what to store if the user adds it */
  canonicalName: string
  /** what was offered to the model, kept for the fallback path */
  candidates: BottleCandidate[]
}

/**
 * Fold a scan's three inputs — what the vision pass saw, what's already on the
 * shelf, and what the reconcile pass concluded — into one row per detection.
 * The local verdict is computed first and stands on its own, so an absent or
 * failed reconcile pass degrades to it rather than blocking the review.
 */
export function resolveDetections<T extends { name: string; category?: string }>(
  detections: T[],
  existing: PantryItem[],
  reconciled: ReconciledVerdict[] = [],
  limit = 5,
): ResolvedBottle<T>[] {
  const byDetected = new Map(reconciled.map((r) => [normIngredient(r.detected), r]))
  return detections.map((detected) => {
    const local = localMatch(detected, existing, limit)
    const remote = byDetected.get(normIngredient(detected.name))
    // An exact string match is a fact, not a judgement call — the model doesn't
    // get to overrule it (and was never asked about it).
    const useRemote = remote && local.verdict !== 'same'
    return {
      detected,
      verdict: useRemote ? remote.verdict : local.verdict,
      canonicalName: (useRemote && remote.canonicalName) || detected.name,
      candidates: local.candidates,
      ...(useRemote ? (remote.match ? { match: remote.match } : {}) : local.match ? { match: local.match } : {}),
    }
  })
}
