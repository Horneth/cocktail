// The generateImage callable — the ONLY way an app client can produce a pool
// image, and the reason no prompt ships in the client bundle.
//
// Contract: the client sends a drink name plus optional glass/garnish/spirit
// hints, and receives `{key, cached}`. The prompt is composed HERE, from the
// shared style contract in ../shared/poolPrompt.mjs (a verbatim copy of
// src/domain/poolPrompt.mjs — a test in src/domain asserts the two files stay
// byte-identical). A crafted name can therefore never steer the model beyond
// one inert line of data, and a pool hit costs nothing.
//
// Security posture, in the order it is enforced:
//   1. App Check + signed-in user only (attestation, then identity).
//   2. Strict input validation — every field is sanitized and length-capped
//      before it can reach a prompt.
//   3. Content-addressed pool hit: a name that already has an image returns
//      without spending anything. This is what makes the shared pool cheap.
//   4. Per-user daily rate limit in Firestore, evaluated BEFORE generation and
//      failing closed (a quota-check outage disables generation; it never
//      disables the limit).
//   5. Generation calls Vertex AI with this function's service account (ADC) —
//      no API key exists anywhere, and the Firebase project's template-only
//      mode for AI Logic does not apply to server-side Vertex calls.
//
// Requires (one-time console setup, see docs/cloud-ai-backend.md):
//   - a Firestore database (the rate-limit counter is its only use)
//   - the Vertex AI API enabled on the project

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { GoogleAuth } from 'google-auth-library'
import sharp from 'sharp'
import { MAX_NAME, poolKeyForName, poolPath, sanitizeDrinkName } from '../shared/poolKey.mjs'
import { buildImagePrompt } from '../shared/poolPrompt.mjs'

initializeApp()

// Env knobs (set in the console or via firebase functions:config equivalents).
// The model must render images AND be callable via Vertex with ADC — verify a
// model id exists on Vertex before shipping a change.
const MODEL = process.env.IMAGE_GEN_MODEL ?? 'gemini-2.5-flash-image'
const REGION = process.env.VERTEX_REGION ?? 'us-central1'
/** Generations one user may spend per UTC day. Pool hits never count. */
const DAILY_LIMIT = Number(process.env.IMAGE_GEN_DAILY_LIMIT ?? 10)

const LONG_FIELD = 60

/** Validate + sanitize the request into a DrinkSpec. Throws invalid-argument. */
function validateInput(data) {
  const str = (v, cap, label, required) => {
    if (v === undefined || v === null) {
      if (required) throw new HttpsError('invalid-argument', `Missing ${label}.`)
      return undefined
    }
    if (typeof v !== 'string') throw new HttpsError('invalid-argument', `Bad ${label}.`)
    // Reject before sanitize so an oversized payload never reaches the model
    // path at all.
    if (v.length > cap) throw new HttpsError('invalid-argument', `${label} is too long.`)
    const clean = sanitizeDrinkName(v)
    if (!clean && required) throw new HttpsError('invalid-argument', `Empty ${label}.`)
    return clean || undefined
  }
  return {
    name: str(data?.name, MAX_NAME, 'drink name', true),
    glass: str(data?.glass, LONG_FIELD, 'glass'),
    garnish: str(data?.garnish, LONG_FIELD, 'garnish'),
    spirit: str(data?.spirit, LONG_FIELD, 'spirit'),
  }
}

async function fileExists(bucket, path) {
  const [exists] = await bucket.file(path).exists()
  return exists
}

/**
 * Per-user, per-UTC-day counter in Firestore. Fails closed: any error reading
 * or writing the counter denies generation — an outage must never become an
 * unmetered spend. Pool hits skip this entirely, which is why seeding the
 * classics keeps them free at any volume.
 */
async function enforceRateLimit(uid) {
  const db = getFirestore()
  const day = new Date().toISOString().slice(0, 10)
  const ref = db.collection('imageGenUsage').doc(`${uid}:${day}`)
  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref)
      const count = snap.exists && snap.data()?.day === day ? (snap.data()?.count ?? 0) : 0
      if (count >= DAILY_LIMIT) {
        throw new HttpsError(
          'resource-exhausted',
          'Daily image limit reached — try again tomorrow.',
        )
      }
      tx.set(ref, { day, count: count + 1 })
    })
  } catch (err) {
    if (err instanceof HttpsError) throw err
    // Real quota-check failures must be loud in the logs but silent in cost.
    console.error('rate-limit check failed closed:', err)
    throw new HttpsError('unavailable', 'Could not check the image quota — try again.')
  }
}

/** One call to the image model via Vertex AI, authenticated with ADC. */
async function generateImageBytes(prompt) {
  const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' })
  const client = await auth.getClient()
  const { token } = await client.getAccessToken()
  const url =
    `https://${REGION}-aiplatform.googleapis.com/v1/projects/${process.env.GCLOUD_PROJECT}` +
    `/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { imageSize: '1K', aspectRatio: '3:4' },
      },
    }),
  })
  if (!res.ok) throw new Error(`Vertex ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
  if (!part?.inlineData?.data) throw new Error('No image returned by the model.')
  return Buffer.from(part.inlineData.data, 'base64')
}

// Same derivative rules as the seeder script: square centre-crops for the 1:1
// containers, full keeps the generated 3:4 hero frame.
async function deriveSizes(raw) {
  return {
    full: await sharp(raw).resize(896, 1200, { fit: 'cover' }).webp({ quality: 78 }).toBuffer(),
    card: await sharp(raw).resize(512, 512, { fit: 'cover' }).webp({ quality: 80 }).toBuffer(),
    thumb: await sharp(raw).resize(256, 256, { fit: 'cover' }).webp({ quality: 80 }).toBuffer(),
  }
}

const UPLOAD_OPTS = {
  contentType: 'image/webp',
  cacheControl: 'public, max-age=31536000, immutable',
}

export const generateImage = onCall(
  {
    enforceAppCheck: true,
    region: REGION,
    maxInstances: 5,
    timeoutSeconds: 120,
    memory: '1GiB',
  },
  async (req) => {
    if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to generate images.')

    const spec = validateInput(req.data)
    const key = poolKeyForName(spec.name)
    if (!key) throw new HttpsError('invalid-argument', 'That name does not name a drink.')

    const bucket = getStorage().bucket()
    const paths = {
      thumb: poolPath(key, 'thumb'),
      card: poolPath(key, 'card'),
      full: poolPath(key, 'full'),
    }

    // Pool hit: the drink already has an image everyone shares. Free.
    const have = await Promise.all(Object.values(paths).map((p) => fileExists(bucket, p)))
    if (have.every(Boolean)) return { key, cached: true }

    await enforceRateLimit(req.auth.uid)

    const raw = await generateImageBytes(buildImagePrompt(spec))
    const sizes = await deriveSizes(raw)
    // Full last so a partial upload never advertises a half entry (the client
    // treats any 404 as "no image" and falls back to the spirit tile).
    await bucket.file(paths.thumb).save(sizes.thumb, UPLOAD_OPTS)
    await bucket.file(paths.card).save(sizes.card, UPLOAD_OPTS)
    await bucket.file(paths.full).save(sizes.full, UPLOAD_OPTS)
    return { key, cached: false }
  },
)
