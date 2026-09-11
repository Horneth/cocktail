// Seed the shared generated-image pool in Firebase Storage.
//
// The pool is content-addressed by drink name (see src/domain/poolKey.mjs):
//   generated/v1/<key>-{thumb,card,full}.webp
// Every user who adds the same drink shares one entry, so seeding the classics
// here is what makes their first save an instant, free hit. The prompt lives
// entirely in src/domain/poolPrompt.mjs — the client never composes prompts.
//
// Usage:
//   GOOGLE_API_KEY=... node scripts/generate-images.mjs               # all classics
//   GOOGLE_API_KEY=... node scripts/generate-images.mjs --only daiquiri
//   GOOGLE_API_KEY=... node scripts/generate-images.mjs --review      # write files, no upload
//   GOOGLE_API_KEY=... node scripts/generate-images.mjs --force       # regenerate existing
//
// Entries already in the pool are skipped (idempotent), so a partially
// finished run resumes where it stopped. Uploads use the same service-account
// story the old publish script had:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json npm run images
// (grant the account roles/storage.objectAdmin on the bucket).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Storage } from '@google-cloud/storage'
import sharp from 'sharp'
import { poolKeyForName, poolPath, sanitizeDrinkName } from '../src/domain/poolKey.mjs'
import { buildImagePrompt, IMAGE_MODEL } from '../src/domain/poolPrompt.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const reviewDir = resolve(root, 'tmp/pool-review')
const model = process.env.GEMINI_IMAGE_MODEL ?? IMAGE_MODEL
const apiKey = process.env.GOOGLE_API_KEY
if (!apiKey) {
  console.error('Set GOOGLE_API_KEY (AI Studio key) to run the pool seeder.')
  process.exit(1)
}

// Bucket: --bucket wins, else VITE_FIREBASE_STORAGE_BUCKET from .env.local.
function bucketFromEnv() {
  try {
    const env = readFileSync(resolve(root, '.env.local'), 'utf8')
    const m = env.match(/^VITE_FIREBASE_STORAGE_BUCKET=(.*)$/m)
    if (m) return m[1].trim().replace(/["']/g, '')
  } catch {
    /* no .env.local */
  }
  return null
}

const argv = process.argv.slice(2)
const only = []
let force = false
let review = false
let argBucket = null
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--only') only.push(argv[++i])
  else if (argv[i] === '--force') force = true
  else if (argv[i] === '--review') review = true
  else if (argv[i] === '--bucket') argBucket = argv[++i]
}
const bucketName = argBucket ?? bucketFromEnv()
if (!review && !bucketName) {
  console.error('No bucket. Pass --bucket <name> or set VITE_FIREBASE_STORAGE_BUCKET in .env.local.')
  process.exit(1)
}

const classics = JSON.parse(readFileSync(resolve(root, 'scripts/classics.json'), 'utf8'))
const targets = only.length ? classics.filter((c) => poolKeyForName(c.name) && only.includes(poolKeyForName(c.name))) : classics
if (only.length && targets.length !== only.length) {
  const known = new Set(classics.map((c) => poolKeyForName(c.name)))
  console.error(`Unknown key(s): ${only.filter((k) => !known.has(k)).join(', ')}`)
  process.exit(1)
}

const storage = review ? null : new Storage()
const bucket = storage ? storage.bucket(bucketName) : null

function classify(err) {
  const msg = err?.message ?? ''
  if (/accountDisabled|billing|disabled in state closed/i.test(msg)) {
    return 'Cloud Storage rejected the upload ("account disabled" — likely a personal Google account via gcloud ADC). Use a dedicated Firebase service account:\n' +
      '  GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json npm run images'
  }
  if (/permissionDenied|403/i.test(msg)) {
    return `Permission denied. Grant the service account "Storage Object Admin" (roles/storage.objectAdmin) on gs://${bucketName}.`
  }
  return msg
}

async function generateFullImage(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { imageSize: '1K', aspectRatio: '3:4' },
        },
      }),
    },
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
  if (!part?.inlineData?.data) throw new Error('No image returned.')
  return Buffer.from(part.inlineData.data, 'base64')
}

// Derivatives from whatever frame the model produced. card/thumb are square
// centre-crops (they render in 1:1 containers), full keeps the 3:4 hero frame.
async function deriveSizes(raw) {
  const base = sharp(raw).resize(896, 1200, { fit: 'cover' })
  return {
    full: await base.clone().webp({ quality: 78 }).toBuffer(),
    card: await sharp(raw).resize(512, 512, { fit: 'cover' }).webp({ quality: 80 }).toBuffer(),
    thumb: await sharp(raw).resize(256, 256, { fit: 'cover' }).webp({ quality: 80 }).toBuffer(),
  }
}

const uploadOpts = {
  gzip: false,
  cacheControl: 'public, max-age=31536000, immutable',
  contentType: 'image/webp',
}

console.log(`Seeding ${targets.length} pool image(s) with ${model}${review ? ' [review only]' : ''}…`)
let seeded = 0
let skipped = 0
for (const spec of targets) {
  const key = poolKeyForName(spec.name)
  try {
    const existing = review ? [false] : await bucket.file(poolPath(key, 'full')).exists()
    if (existing[0] && !force) {
      skipped += 1
      console.log('  =', key, '(already in the pool)')
      continue
    }
    const prompt = buildImagePrompt({
      name: sanitizeDrinkName(spec.name),
      glass: spec.glass,
      garnish: spec.garnish,
      spirit: spec.spirit,
    })
    const raw = await generateFullImage(prompt)
    const sizes = await deriveSizes(raw)
    for (const size of ['thumb', 'card', 'full']) {
      if (review) {
        mkdirSync(reviewDir, { recursive: true })
        writeFileSync(resolve(reviewDir, `${key}-${size}.webp`), sizes[size])
      } else {
        await bucket.file(poolPath(key, size)).save(sizes[size], uploadOpts)
      }
    }
    seeded += 1
    console.log('  ✓', key)
  } catch (err) {
    console.error('  ✗', key, classify(err) || err.message)
  }
}
console.log(`Done. ${seeded} seeded, ${skipped} already present.` +
  (review ? ` Review files in tmp/pool-review/ — nothing was uploaded.` : ` Pool: gs://${bucketName}/generated/v1/`))
