import { FEATURES, functionsRegion, isCloudAIConfigured } from '../config'
import { ensureFirebaseApp } from '../auth/firebase'
import { logAiCall } from '../auth/analytics'
import { MAX_INGREDIENTS, MAX_NAME, poolKeyForName, sanitizeDrinkName } from '../domain/poolKey.mjs'
import { CloudAIError, friendlyError } from './firebaseAI'
import { ImageLimitError } from './imageLimit'

// Client transport for the image pool's Cloud Function (`generateImage`).
//
// Unlike the AI Logic calls, nothing prompt-shaped leaves the client: the
// payload is five short recipe fields, the function composes the prompt
// server-side and returns a pool key. The client then only ever derives the
// content-addressed Storage URL from that key (see domain/imagePool.ts) —
// a hostile server answer could not make this app render a URL it chose.
//
// Same gate discipline as every AI path: FEATURES kill switch, build config,
// and a signed-in user — the callable additionally enforces App Check and
// auth server-side, so the client gate is UX, not security.

/** The drink facts the function is allowed to see. */
export interface GenerateImageSpec {
  name: string
  glass?: string
  garnish?: string
  spirit?: string
  /** key ingredient names — the colour signal */
  ingredients?: string[]
}

export interface GenerateImageResult {
  /** Pool key for the drink — render with `gen:<key>`. */
  key: string
  /** true = the pool already had this drink; no generation was spent. */
  cached: boolean
}

/**
 * The function marks the daily-limit rejection `{ kind: 'daily-limit' }` in its
 * details — prose matching is only the fallback for a deploy that predates the
 * marker. The error itself lives in imageLimit.ts (dependency-free).
 */
function asImageError(err: unknown): CloudAIError | ImageLimitError {
  const code = (err as { code?: unknown } | null)?.code
  const details = (err as { details?: { kind?: unknown } | null } | null)?.details
  const msg = err instanceof Error ? err.message : String(err)
  if (
    (code === 'functions/resource-exhausted' && details?.kind === 'daily-limit') ||
    /daily image limit/i.test(msg)
  ) {
    return new ImageLimitError()
  }
  return new CloudAIError(friendlyError(err))
}

/** Ask the pool for an image, generating one only if nobody ever has. */
export async function firebaseGenerateImage(spec: GenerateImageSpec): Promise<GenerateImageResult> {
  if (!FEATURES.cloudAI) throw new CloudAIError('Image generation is turned off in this build.')
  if (!isCloudAIConfigured()) throw new CloudAIError('Cloud AI is not configured for this deployment.')

  // Client-side validation mirrors the function's — fails fast, before the SDK
  // even loads. The server re-validates everything; this is the UX layer.
  // Length caps apply to the RAW input (like the server does), sanitize then
  // runs, and the name must still reduce to a pool key.
  if (typeof spec.name !== 'string' || !spec.name.trim()) {
    throw new CloudAIError('That name does not name a drink.')
  }
  if (spec.name.length > MAX_NAME) throw new CloudAIError('That drink name is too long.')
  const name = sanitizeDrinkName(spec.name)
  if (!poolKeyForName(name)) throw new CloudAIError('That name does not name a drink.')

  let data: { key?: unknown; cached?: unknown }
  try {
    const app = await ensureFirebaseApp()
    const { getFunctions, httpsCallable } = await import('firebase/functions')
    const call = httpsCallable<GenerateImageSpec, { key?: string; cached?: boolean }>(
      getFunctions(app, functionsRegion),
      'generateImage',
    )
    const res = await call({
      name,
      glass: spec.glass ? sanitizeDrinkName(spec.glass).slice(0, 60) : undefined,
      garnish: spec.garnish ? sanitizeDrinkName(spec.garnish).slice(0, 60) : undefined,
      spirit: spec.spirit ? sanitizeDrinkName(spec.spirit).slice(0, 60) : undefined,
      ingredients: spec.ingredients
        ? spec.ingredients
            .filter((v) => typeof v === 'string' && v.trim())
            .slice(0, MAX_INGREDIENTS)
            .map((v) => sanitizeDrinkName(v))
            .filter(Boolean)
        : undefined,
    })
    data = res.data
  } catch (err) {
    logAiCall('image', 'error')
    throw asImageError(err)
  }

  if (typeof data?.key !== 'string' || !data.key) {
    logAiCall('image', 'error')
    throw new CloudAIError('The image service returned nothing — try again.')
  }
  logAiCall('image', 'ok')
  return { key: data.key, cached: data.cached === true }
}
