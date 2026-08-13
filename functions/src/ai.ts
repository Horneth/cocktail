import { HttpsError, onCall, type CallableOptions } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { logger } from 'firebase-functions'
import {
  BOTTLES_SCHEMA,
  DUPE_PROMPT,
  DUPE_SCHEMA,
  PROMPT,
  RECONCILE_SCHEMA,
  RESPONSE_SCHEMA,
  VISION_PROMPT,
  buildReconcilePrompt,
} from '../../src/import/aiShared'
import type { DupeQuery, ReconcileInput } from '../../src/import/aiShared'
import {
  MAX_DUPE_QUERIES,
  MAX_IMAGE_BYTES,
  MAX_OUTPUT_TOKENS,
  MAX_PARSE_CHARS,
  MAX_RECONCILE_INPUTS,
  MAX_SCAN_IMAGES,
} from '../../src/import/limits'
import { generateJson, type InlineImage } from './gemini'
import { charge, type UsageSnapshot } from './usage'

// The four AI entry points, moved off the client. Each one is the same call the
// browser used to make directly, with four things in front of it that a client
// cannot be trusted to do for itself: App Check, an authenticated user, payload
// caps, and a metered counter.
//
// What they return is the model's raw JSON. The mappers that turn it into our
// domain types stayed in the browser on purpose — they encode product
// vocabulary that changes often, and nobody wants a Functions deploy in the loop
// for a tag rename.

const geminiKey = defineSecret('GEMINI_API_KEY')

const options: CallableOptions = {
  secrets: [geminiKey],
  enforceAppCheck: true,
  // Cost containment, not capacity planning: a runaway loop must not be able to
  // autoscale into a four-figure bill before anyone notices.
  maxInstances: 10,
  timeoutSeconds: 120,
}

export interface AiResponse<T = unknown> {
  json: T
  usage: UsageSnapshot | null
}

function requireUid(auth: { uid: string } | undefined): string {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to use AI features.')
  return auth.uid
}

/**
 * Wrap a model failure. The real error can carry quota details, prompt fragments
 * and internal identifiers, so it goes to the log and a flat message goes to the
 * client — `internal` rather than a code the client might branch on.
 */
function modelFailure(err: unknown, call: string): HttpsError {
  logger.error(`${call} failed`, err)
  return new HttpsError('internal', 'The AI request failed — try again in a moment.')
}

/** Recipe text → raw `{ recipes: [...] }`. The heavy half of an import. */
export const aiParse = onCall(options, async (request): Promise<AiResponse> => {
  const uid = requireUid(request.auth)
  const text = typeof request.data?.text === 'string' ? request.data.text : ''
  if (!text.trim()) throw new HttpsError('invalid-argument', 'No text to read.')
  if (text.length > MAX_PARSE_CHARS) {
    throw new HttpsError('invalid-argument', "That's longer than an import can take.")
  }

  const usage = await charge(uid, 'parse')
  try {
    const json = await generateJson({
      apiKey: geminiKey.value(),
      prompt: `${PROMPT}\n\nDESCRIPTION:\n${text}`,
      schema: RESPONSE_SCHEMA,
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS.parse,
    })
    return { json, usage }
  } catch (err) {
    throw modelFailure(err, 'aiParse')
  }
})

/**
 * Duplicate verdicts. Not separately metered — it's bundled into the import the
 * user actually asked for, and charging for a check that exists to be helpful
 * would mean the app quietly punishing people for a feature they didn't request.
 */
export const aiJudgeDuplicates = onCall(options, async (request): Promise<AiResponse> => {
  requireUid(request.auth)
  const queries = asArray<DupeQuery>(request.data?.queries, MAX_DUPE_QUERIES, 'queries')
  const asked = queries.filter((q) => Array.isArray(q?.candidates) && q.candidates.length > 0)
  if (!asked.length) return { json: { verdicts: [] }, usage: null }

  // Only what a local pass already shortlisted travels: a name, its aliases, and
  // the few library names that looked close. Re-projected here rather than
  // forwarded, so a client cannot smuggle extra fields into the prompt.
  const payload = asked.map((q) => ({
    index: q.index,
    name: q.name,
    aka: q.aka,
    candidates: q.candidates,
  }))

  try {
    const json = await generateJson({
      apiKey: geminiKey.value(),
      prompt: `${DUPE_PROMPT}\n\nENTRIES:\n${JSON.stringify(payload)}`,
      schema: DUPE_SCHEMA,
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS.dupes,
    })
    return { json, usage: null }
  } catch (err) {
    throw modelFailure(err, 'aiJudgeDuplicates')
  }
})

/** Shelf photos → raw `{ bottles: [...] }`. The expensive call in the app. */
export const aiIdentifyBottles = onCall(options, async (request): Promise<AiResponse> => {
  const uid = requireUid(request.auth)
  const images = asArray<InlineImage>(request.data?.images, MAX_SCAN_IMAGES, 'images')
  if (!images.length) throw new HttpsError('invalid-argument', 'No photos to scan.')
  for (const image of images) {
    if (typeof image?.mimeType !== 'string' || typeof image?.data !== 'string') {
      throw new HttpsError('invalid-argument', 'A photo was in an unsupported format.')
    }
    if (!image.mimeType.startsWith('image/')) {
      throw new HttpsError('invalid-argument', 'A photo was in an unsupported format.')
    }
    // base64 is 4 characters per 3 bytes; compare without decoding.
    if ((image.data.length * 3) / 4 > MAX_IMAGE_BYTES) {
      throw new HttpsError('invalid-argument', 'A photo was too large to send.')
    }
  }

  const usage = await charge(uid, 'scan')
  try {
    const json = await generateJson({
      apiKey: geminiKey.value(),
      prompt: VISION_PROMPT,
      schema: BOTTLES_SCHEMA,
      temperature: 0.1,
      maxOutputTokens: MAX_OUTPUT_TOKENS.bottles,
      images,
    })
    return { json, usage }
  } catch (err) {
    throw modelFailure(err, 'aiIdentifyBottles')
  }
})

/** The shelf-scan twin of the duplicate check, and bundled for the same reason. */
export const aiReconcileBottles = onCall(options, async (request): Promise<AiResponse> => {
  requireUid(request.auth)
  const inputs = asArray<ReconcileInput>(request.data?.inputs, MAX_RECONCILE_INPUTS, 'inputs')
  const comparable = inputs.filter((i) => Array.isArray(i?.candidates) && i.candidates.length > 0)
  if (!comparable.length) return { json: { matches: [] }, usage: null }

  try {
    const json = await generateJson({
      apiKey: geminiKey.value(),
      // Built here, from the shared builder, so the prompt is never something a
      // caller supplies — that would be both an unbounded token cost and an
      // injection surface.
      prompt: buildReconcilePrompt(comparable),
      schema: RECONCILE_SCHEMA,
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS.reconcile,
    })
    return { json, usage: null }
  } catch (err) {
    throw modelFailure(err, 'aiReconcileBottles')
  }
})

function asArray<T>(value: unknown, max: number, field: string): T[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) {
    throw new HttpsError('invalid-argument', `Expected ${field} to be a list.`)
  }
  if (value.length > max) {
    throw new HttpsError('invalid-argument', `Too many ${field} in one request.`)
  }
  return value as T[]
}
