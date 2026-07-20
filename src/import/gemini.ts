import { splitDataUrl } from './image'
import {
  BOTTLES_SCHEMA,
  PROMPT,
  RESPONSE_SCHEMA,
  VISION_PROMPT,
  dedupeBottles,
  finishParse,
  mapAiRecipe,
} from './aiShared'
import type { AiRecipe, IdentifiedBottle } from './aiShared'
import type { StructuredImport } from './types'

// Optional cloud parsing via the Gemini API. The user supplies their own API
// key (stored only in their browser); the call goes straight from the browser
// to Google. No key ever lives in this repo. The heuristic parser remains the
// always-available fallback.
//
// This file is just the cloud *transport*. The schemas, prompts, and the pure
// mappers that turn raw model JSON into a StructuredImport live in `aiShared.ts`
// and are shared with every other AI backend.

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

// Re-exports so existing importers (and the mapper tests) keep their old names.
export { dedupeBottles }
export { mapAiRecipe as mapGeminiRecipe }
export type { IdentifiedBottle }
export type { AiRecipe as GeminiRecipe }

export class GeminiError extends Error {}

/**
 * Call Gemini and return one StructuredImport per drink found in the text.
 * A description commonly holds several cocktails. Throws GeminiError on failure.
 */
export async function geminiParse(
  text: string,
  apiKey: string,
  model = DEFAULT_GEMINI_MODEL,
): Promise<StructuredImport[]> {
  if (!apiKey.trim()) throw new GeminiError('No API key set.')

  let res: Response
  // Abort a hung request so the Import screen can never freeze on the spinner
  // forever — surface a retryable error instead.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${PROMPT}\n\nDESCRIPTION:\n${text}` }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
        },
      }),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new GeminiError('Gemini took too long to respond — try again, or use Basic parse.')
    }
    // network / CORS failure
    throw new GeminiError(
      'Could not reach Gemini from the browser (network or CORS). Use Basic parse, or set up a proxy.',
    )
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 400 || res.status === 403) {
      throw new GeminiError('Gemini rejected the request — check that your API key is valid and enabled.')
    }
    if (res.status === 429) throw new GeminiError('Gemini rate limit reached — try again in a moment.')
    throw new GeminiError(`Gemini error ${res.status}. ${detail.slice(0, 140)}`)
  }

  const data = await res.json()
  const jsonText: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!jsonText) throw new GeminiError('Gemini returned no content.')

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new GeminiError('Gemini returned malformed JSON.')
  }

  const results = finishParse(parsed, text)
  if (!results.length) throw new GeminiError('Gemini found no recipes.')
  return results
}

// ── Photo → bar (Gemini vision) ────────────────────────────────────────────

type ContentPart = { text: string } | { inlineData: { mimeType: string; data: string } }

/**
 * Identify the bottles visible in one or more photos (data URLs). Returns a
 * deduped list the user can review before adding to a bar. Throws GeminiError.
 */
export async function geminiIdentifyBottles(
  images: string[],
  apiKey: string,
  model = DEFAULT_GEMINI_MODEL,
): Promise<IdentifiedBottle[]> {
  if (!apiKey.trim()) throw new GeminiError('No API key set.')
  if (!images.length) throw new GeminiError('No photos to scan.')

  const parts: ContentPart[] = [{ text: VISION_PROMPT }]
  for (const dataUrl of images) {
    const split = splitDataUrl(dataUrl)
    if (!split) throw new GeminiError('One of the photos was in an unsupported format.')
    parts.push({ inlineData: { mimeType: split.mimeType, data: split.data } })
  }

  let res: Response
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    res = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey.trim() },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: BOTTLES_SCHEMA,
          temperature: 0.1,
        },
      }),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new GeminiError('Gemini took too long to respond — try again.')
    }
    throw new GeminiError(
      'Could not reach Gemini from the browser (network or CORS). Try again, or add bottles by hand.',
    )
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    if (res.status === 400 || res.status === 403) {
      throw new GeminiError('Gemini rejected the request — check that your API key is valid and enabled.')
    }
    if (res.status === 429) throw new GeminiError('Gemini rate limit reached — try again in a moment.')
    throw new GeminiError(`Gemini error ${res.status}. ${detail.slice(0, 140)}`)
  }

  const data = await res.json()
  const jsonText: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!jsonText) throw new GeminiError('Gemini returned no content.')

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new GeminiError('Gemini returned malformed JSON.')
  }

  const raw = (parsed as { bottles?: { name?: string; category?: string }[] })?.bottles ?? []
  return dedupeBottles(raw)
}
