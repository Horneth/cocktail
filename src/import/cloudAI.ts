import { callAi } from '../auth/firebase'
import { splitDataUrl } from './image'
import {
  dedupeBottles,
  finishDupeJudgement,
  finishParse,
  parseReconcile,
} from './aiShared'
import type {
  DupeQuery,
  DupeVerdict,
  IdentifiedBottle,
  ReconcileInput,
  ReconcileMatch,
} from './aiShared'
import { MAX_IMAGE_BYTES, MAX_PARSE_CHARS, MAX_SCAN_IMAGES } from './limits'
import type { StructuredImport } from './types'

// Cloud AI transport. The four functions below have the same signatures and the
// same contracts as the direct-to-Gemini versions they replaced — what changed
// is only what sits between them and the model.
//
// The split is deliberate: the callable returns the model's raw JSON and the
// mappers below (`finishParse`, `dedupeBottles`, `parseReconcile`) still run
// here. They encode product vocabulary from `domain/vocab.ts` that changes far
// more often than the prompts do, and keeping them client-side means a tag
// rename is a web deploy rather than a Functions deploy.
//
// The client-side limit checks are not the enforcement — the callable checks the
// same numbers and is the one that gets billed. These just save a round trip and
// give a better message than a rejected request would.

export class CloudAIError extends Error {}

interface AiResponse<T = unknown> {
  json: T
  usage: UsageSnapshot | null
}

export interface UsageSnapshot {
  tier: 'free' | 'pro'
  lifetime: { parse: number; scan: number }
  month: { parse: number; scan: number }
}

/** Last known tier and counters. Written by every AI call, read by the UI. */
let lastUsage: UsageSnapshot | null = null
export const latestUsage = (): UsageSnapshot | null => lastUsage

function friendlyError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? ''
  const msg = err instanceof Error ? err.message : String(err)

  // Callables surface our own HttpsError messages verbatim, so anything the
  // server chose to say is already the right thing to show.
  if (/unauthenticated/.test(code)) return 'Sign in to use AI features.'
  if (/resource-exhausted|unavailable|invalid-argument/.test(code)) return msg
  if (/app.?check|recaptcha/i.test(msg)) {
    return 'App Check rejected the request — check the reCAPTCHA setup for this domain.'
  }
  if (/network|fetch|timeout|internal/i.test(code + msg)) {
    return 'Could not reach the AI service — check your connection and try again.'
  }
  return 'Cloud AI request failed — try again in a moment.'
}

async function call<T>(name: string, data: unknown): Promise<T> {
  const result = (await callAi(name, data)) as AiResponse<T>
  if (result?.usage) lastUsage = result.usage
  return result?.json as T
}

/** Parse recipe text into one StructuredImport per drink. Throws CloudAIError. */
export async function cloudParse(text: string): Promise<StructuredImport[]> {
  if (text.length > MAX_PARSE_CHARS) {
    throw new CloudAIError(
      `That's longer than an import can take — trim it to about ${MAX_PARSE_CHARS / 1000}k characters.`,
    )
  }

  let parsed: unknown
  try {
    parsed = await call('aiParse', { text })
  } catch (err) {
    throw new CloudAIError(friendlyError(err))
  }

  const recipes = finishParse(parsed, text)
  if (!recipes.length) throw new CloudAIError('No recipes found in that text.')
  return recipes
}

/**
 * Ask whether any incoming drink is already in the collection.
 *
 * The payload is only what a local pass already shortlisted: a drink's name, its
 * aliases, and the few library names that looked close. No ingredients, no ids,
 * no notes, and nothing at all when nothing matched locally — which is the
 * common case, so most imports never make this call.
 *
 * Never throws. A duplicate check that fails is a preview without badges, not a
 * failed import.
 */
export async function cloudJudgeDuplicates(queries: DupeQuery[]): Promise<DupeVerdict[]> {
  const asked = queries.filter((q) => q.candidates.length > 0)
  if (!asked.length) return []

  try {
    const payload = asked.map((q) => ({
      index: q.index,
      name: q.name,
      aka: q.aka,
      candidates: q.candidates,
    }))
    return finishDupeJudgement(await call('aiJudgeDuplicates', { queries: payload }), asked)
  } catch {
    return []
  }
}

/** Identify bottles in photos (data URLs). Throws CloudAIError. */
export async function cloudIdentifyBottles(images: string[]): Promise<IdentifiedBottle[]> {
  if (!images.length) throw new CloudAIError('No photos to scan.')
  if (images.length > MAX_SCAN_IMAGES) {
    throw new CloudAIError(`A scan takes at most ${MAX_SCAN_IMAGES} photos at a time.`)
  }

  // Sent as `{mimeType, data}` rather than whole data URLs: the server has to
  // validate the parts either way, and this keeps `image.ts` — which needs a
  // DOM — out of the Functions build.
  const parts = images.map((dataUrl) => {
    const split = splitDataUrl(dataUrl)
    if (!split) throw new CloudAIError('One of the photos was in an unsupported format.')
    if ((split.data.length * 3) / 4 > MAX_IMAGE_BYTES) {
      throw new CloudAIError('One of the photos was too large to send.')
    }
    return split
  })

  let parsed: unknown
  try {
    parsed = await call('aiIdentifyBottles', { images: parts })
  } catch (err) {
    throw new CloudAIError(friendlyError(err))
  }

  const raw = (parsed as { bottles?: Parameters<typeof dedupeBottles>[0] })?.bottles ?? []
  return dedupeBottles(raw)
}

/**
 * Pass 2 of the shelf scan: decide which detections are bottles the user already
 * has. Only the detected names and their few on-device-picked candidates are
 * sent — never the inventory — and detections with no candidates are already
 * "new", so a scan into an empty bar never reaches this call at all.
 *
 * Never throws, for the same reason as `cloudJudgeDuplicates`: this runs after
 * the shelf has already been read, and `domain/bottleMatch` has a local verdict
 * for every detection. A failure here means a review sheet built from those
 * instead of the model's, not a failed scan.
 */
export async function cloudReconcileBottles(inputs: ReconcileInput[]): Promise<ReconcileMatch[]> {
  const comparable = inputs.filter((i) => i.candidates.length > 0)
  if (!comparable.length) return []

  try {
    return parseReconcile(await call('aiReconcileBottles', { inputs: comparable }), comparable)
  } catch {
    return []
  }
}
