import { Schema } from 'firebase/ai'
import { getGeminiModel } from '../auth/firebase'
import { splitDataUrl } from './image'
import {
  BOTTLES_SCHEMA,
  PROMPT,
  RESPONSE_SCHEMA,
  VISION_PROMPT,
  dedupeBottles,
  finishParse,
} from './aiShared'
import type { IdentifiedBottle, OpenApiSchema } from './aiShared'
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
  return 'Cloud AI request failed — try again, or use Basic parse.'
}

/** Parse recipe text into one StructuredImport per drink. Throws CloudAIError. */
export async function firebaseParse(text: string): Promise<StructuredImport[]> {
  let jsonText: string
  try {
    const model = await getGeminiModel({
      responseMimeType: 'application/json',
      responseSchema: toFirebaseSchema(RESPONSE_SCHEMA),
      temperature: 0.2,
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
    throw new CloudAIError('The AI returned malformed JSON — try again, or use Basic parse.')
  }

  const recipes = finishParse(parsed, text)
  if (!recipes.length) throw new CloudAIError('No recipes found in that text.')
  return recipes
}

/** Identify bottles in photos (data URLs). Throws CloudAIError. */
export async function firebaseIdentifyBottles(images: string[]): Promise<IdentifiedBottle[]> {
  if (!images.length) throw new CloudAIError('No photos to scan.')

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: VISION_PROMPT },
  ]
  for (const dataUrl of images) {
    const split = splitDataUrl(dataUrl)
    if (!split) throw new CloudAIError('One of the photos was in an unsupported format.')
    parts.push({ inlineData: { mimeType: split.mimeType, data: split.data } })
  }

  let jsonText: string
  try {
    const model = await getGeminiModel({
      responseMimeType: 'application/json',
      responseSchema: toFirebaseSchema(BOTTLES_SCHEMA),
      temperature: 0.1,
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

  const raw = (parsed as { bottles?: { name?: string; category?: string }[] })?.bottles ?? []
  return dedupeBottles(raw)
}
