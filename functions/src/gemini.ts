import { GoogleGenAI } from '@google/genai'
import type { OpenApiSchema } from '../../src/import/aiShared'

// The Gemini transport, server side. This is the half of the old
// `src/import/firebaseAI.ts` that had to move: the prompts, the model name and
// the generation config now live where a client can neither read nor change
// them. Everything below the transport line — the mappers that turn model JSON
// into our types — deliberately stayed in the browser.

/**
 * Kept here rather than in `src/config.ts` so swapping models is a Functions
 * deploy, not a client release. Once the app ships through an app store that
 * distinction is the difference between minutes and a review queue.
 */
export const MODEL = process.env.COCKTAIL_AI_MODEL || 'gemini-3.5-flash-lite'

let client: GoogleGenAI | null = null

function genAI(apiKey: string): GoogleGenAI {
  // Reused across invocations on a warm instance; the key is identical for all
  // of them, so rebuilding per call would only cost handshakes.
  if (!client) client = new GoogleGenAI({ apiKey })
  return client
}

/**
 * Our OpenAPI-subset schema → the shape Gemini's `responseSchema` wants. The
 * only real transform is the type name: the API spells them `OBJECT`/`STRING`,
 * and unlike the Firebase SDK's `Schema` builders this one takes `required`
 * directly rather than an inverted `optionalProperties` list.
 */
export function toGenAiSchema(s: OpenApiSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (s.type) out.type = s.type.toUpperCase()
  if (s.nullable) out.nullable = true
  if (s.properties) {
    out.properties = Object.fromEntries(
      Object.entries(s.properties).map(([k, v]) => [k, toGenAiSchema(v)]),
    )
  }
  if (s.items) out.items = toGenAiSchema(s.items)
  if (s.required) out.required = [...s.required]
  return out
}

export interface InlineImage {
  mimeType: string
  data: string
}

export interface GenerateOptions {
  apiKey: string
  prompt: string
  schema: OpenApiSchema
  temperature: number
  maxOutputTokens: number
  images?: InlineImage[]
}

/**
 * One structured-output call. Returns the parsed JSON — the caller decides what
 * a malformed or empty response means, because the two optional calls treat it
 * as "no verdicts" while the two primary ones treat it as an error.
 */
export async function generateJson(opts: GenerateOptions): Promise<unknown> {
  const parts: Array<{ text: string } | { inlineData: InlineImage }> = [{ text: opts.prompt }]
  for (const image of opts.images ?? []) parts.push({ inlineData: image })

  const response = await genAI(opts.apiKey).models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: 'application/json',
      responseSchema: toGenAiSchema(opts.schema),
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
    },
  })

  const text = response.text
  if (!text) throw new Error('The model returned an empty response.')
  return JSON.parse(text)
}
