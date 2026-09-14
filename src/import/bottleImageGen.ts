import { FEATURES, functionsRegion, isCloudAIConfigured } from '../config'
import { ensureFirebaseApp } from '../auth/firebase'
import { logAiCall } from '../auth/analytics'
import { bottlePoolKeyFor, sanitizeBottleName } from '../domain/bottlePool.mjs'
import { CloudAIError, friendlyError } from './firebaseAI'
import { ImageLimitError } from './imageLimit'

export interface GenerateBottleImageSpec {
  name: string
  category?: string
  brand?: string
}

export interface GenerateBottleImageResult {
  key: string
  cached: boolean
}

function asImageError(err: unknown): CloudAIError | ImageLimitError {
  const code = (err as { code?: unknown } | null)?.code
  const details = (err as { details?: { kind?: unknown } | null } | null)?.details
  const msg = err instanceof Error ? err.message : String(err)
  if ((code === 'functions/resource-exhausted' && details?.kind === 'daily-limit') || /daily image limit/i.test(msg)) {
    return new ImageLimitError()
  }
  return new CloudAIError(friendlyError(err))
}

export async function firebaseGenerateBottleImage(
  spec: GenerateBottleImageSpec,
): Promise<GenerateBottleImageResult> {
  if (!FEATURES.cloudAI) throw new CloudAIError('Image generation is turned off in this build.')
  if (!isCloudAIConfigured()) throw new CloudAIError('Cloud AI is not configured for this deployment.')
  if (typeof spec.name !== 'string' || !spec.name.trim()) throw new CloudAIError('That bottle has no name.')
  const name = sanitizeBottleName(spec.name)
  const category = spec.category ? sanitizeBottleName(spec.category).slice(0, 60) : undefined
  const brand = spec.brand ? sanitizeBottleName(spec.brand).slice(0, 60) : undefined
  const key = bottlePoolKeyFor(name, category)
  if (!key) throw new CloudAIError('That bottle name is unusable.')

  try {
    const app = await ensureFirebaseApp()
    const { getFunctions, httpsCallable } = await import('firebase/functions')
    const call = httpsCallable<GenerateBottleImageSpec, { key?: string; cached?: boolean }>(
      getFunctions(app, functionsRegion),
      'generateBottleImage',
    )
    const res = await call({ name, category, brand })
    if (typeof res.data?.key !== 'string' || !res.data.key) throw new CloudAIError('The image service returned nothing — try again.')
    logAiCall('image', 'ok')
    return { key: res.data.key, cached: res.data.cached === true }
  } catch (err) {
    logAiCall('image', 'error')
    if (err instanceof CloudAIError) throw err
    throw asImageError(err)
  }
}
