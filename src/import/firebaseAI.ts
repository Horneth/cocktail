import { Schema } from 'firebase/ai'
import { getGeminiModel } from '../auth/firebase'
import { dataUrlBytes, splitDataUrl } from './image'
import {
  BOTTLES_SCHEMA,
  DUPE_PROMPT,
  DUPE_SCHEMA,
  PROMPT,
  RECONCILE_SCHEMA,
  RESPONSE_SCHEMA,
  VISION_PROMPT,
  buildReconcilePrompt,
  dedupeBottles,
  finishDupeJudgement,
  finishParse,
  parseReconcile,
} from './aiShared'
import type {
  DupeQuery,
  DupeVerdict,
  IdentifiedBottle,
  OpenApiSchema,
  ReconcileInput,
  ReconcileMatch,
} from './aiShared'
import {
  MAX_IMAGE_BYTES,
  MAX_OUTPUT_TOKENS,
  MAX_PARSE_CHARS,
  MAX_SCAN_IMAGES,
} from './limits'
import type { StructuredImport } from './types'

// Cloud AI transport via Firebase AI Logic. Signature-compatible in spirit with
// the old BYO-key `gemini.ts` (no apiKey — auth is handled by Firebase). It
// reuses the shared prompts, schemas, and pure mappers from `aiShared.ts`; only
// the transport (Firebase SDK instead of raw fetch) differs.

export class CloudAIError extends Error {}

// Convert our OpenAPI-subset schema into a Firebase AI `Schema` so the model is
// constrained to valid JSON (the same guarantee Gemini's responseSchema gave us).
function toFirebaseSchema(s: OpenApiSchema): Schema {
  switch (s.type) {
    case 'object': {
      const props = s.properties ?? {}
      const properties: Record<string, Schema> = {}
      for (const [k, v] of Object.entries(props)) properties[k] = toFirebaseSchema(v)
      const required = s.required ?? []
      const optionalProperties = Object.keys(props).filter((k) => !required.includes(k))
      return Schema.object({ properties, optionalProperties })
    }
    case 'array':
      return Schema.array({ items: toFirebaseSchema(s.items ?? { type: 'string' }) })
    case 'number':
      return Schema.number({ nullable: s.nullable })
    case 'boolean':
      return Schema.boolean({ nullable: s.nullable })
    case 'string':
    default:
      return Schema.string({ nullable: s.nullable })
  }
}

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/app.?check|recaptcha/i.test(msg)) {
    return 'App Check rejected the request — check the reCAPTCHA setup for this domain.'
  }
  if (/quota|rate|429|resource-exhausted/i.test(msg)) {
    return 'Cloud AI is rate-limited right now — try again in a moment.'
  }
  if (/network|fetch|timeout/i.test(msg)) {
    return 'Could not reach the AI service — check your connection and try again.'
  }
  return 'Cloud AI request failed — try again in a moment.'
}

/** Parse recipe text into one StructuredImport per drink. Throws CloudAIError. */
export async function firebaseParse(text: string): Promise<StructuredImport[]> {
  if (text.length > MAX_PARSE_CHARS) {
    throw new CloudAIError(
      `That's longer than an import can take — trim it to about ${MAX_PARSE_CHARS / 1000}k characters.`,
    )
  }

  let jsonText: string
  try {
    const model = await getGeminiModel({
      responseMimeType: 'application/json',
      responseSchema: toFirebaseSchema(RESPONSE_SCHEMA),
      temperature: 0.2,
      maxOutputTokens: MAX_OUTPUT_TOKENS.parse,
    })
    const result = await model.generateContent(`${PROMPT}\n\nDESCRIPTION:\n${text}`)
    jsonText = result.response.text()
  } catch (err) {
    throw new CloudAIError(friendlyError(err))
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new CloudAIError('The AI returned malformed JSON — try again.')
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
export async function firebaseJudgeDuplicates(queries: DupeQuery[]): Promise<DupeVerdict[]> {
  const asked = queries.filter((q) => q.candidates.length > 0)
  if (!asked.length) return []

  try {
    const model = await getGeminiModel({
      responseMimeType: 'application/json',
      responseSchema: toFirebaseSchema(DUPE_SCHEMA),
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS.dupes,
    })
    const payload = asked.map((q) => ({
      index: q.index,
      name: q.name,
      aka: q.aka,
      candidates: q.candidates,
    }))
    const result = await model.generateContent(
      `${DUPE_PROMPT}\n\nENTRIES:\n${JSON.stringify(payload)}`,
    )
    return finishDupeJudgement(JSON.parse(result.response.text()), asked)
  } catch {
    return []
  }
}

/** Identify bottles in photos (data URLs). Throws CloudAIError. */
export async function firebaseIdentifyBottles(images: string[]): Promise<IdentifiedBottle[]> {
  if (!images.length) throw new CloudAIError('No photos to scan.')
  // The caller already slices to this, and `downscaleDataUrl` already shrinks to
  // fit the byte budget — but the transport is the boundary that gets billed, so
  // it enforces both rather than trusting its callers to have done it.
  if (images.length > MAX_SCAN_IMAGES) {
    throw new CloudAIError(`A scan takes at most ${MAX_SCAN_IMAGES} photos at a time.`)
  }

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: VISION_PROMPT },
  ]
  for (const dataUrl of images) {
    const split = splitDataUrl(dataUrl)
    if (!split) throw new CloudAIError('One of the photos was in an unsupported format.')
    if (dataUrlBytes(dataUrl) > MAX_IMAGE_BYTES) {
      throw new CloudAIError('One of the photos was too large to send.')
    }
    parts.push({ inlineData: { mimeType: split.mimeType, data: split.data } })
  }

  let jsonText: string
  try {
    const model = await getGeminiModel({
      responseMimeType: 'application/json',
      responseSchema: toFirebaseSchema(BOTTLES_SCHEMA),
      temperature: 0.1,
      maxOutputTokens: MAX_OUTPUT_TOKENS.bottles,
    })
    const result = await model.generateContent(parts)
    jsonText = result.response.text()
  } catch (err) {
    throw new CloudAIError(friendlyError(err))
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new CloudAIError('The AI returned malformed JSON — try again.')
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
 * Never throws, for the same reason as `firebaseJudgeDuplicates`: this runs after
 * the shelf has already been read, and `domain/bottleMatch` has a local verdict
 * for every detection. A failure here means a review sheet built from those
 * instead of the model's, not a failed scan.
 */
export async function firebaseReconcileBottles(inputs: ReconcileInput[]): Promise<ReconcileMatch[]> {
  const comparable = inputs.filter((i) => i.candidates.length > 0)
  if (!comparable.length) return []

  try {
    const model = await getGeminiModel({
      responseMimeType: 'application/json',
      responseSchema: toFirebaseSchema(RECONCILE_SCHEMA),
      temperature: 0,
      maxOutputTokens: MAX_OUTPUT_TOKENS.reconcile,
    })
    const result = await model.generateContent(buildReconcilePrompt(comparable))
    return parseReconcile(JSON.parse(result.response.text()), comparable)
  } catch {
    return []
  }
}
