// Publish the generated cocktail images + manifest to Firebase Storage.
//
// Uploads `public/images/cocktails/*` to `gs://<bucket>/cocktails/` with a long
// cache TTL (the URLs are immutable per slug — a re-run overwrites and the app
// re-fetches). Then writes `cocktails/manifest.json` (the last file, so a
// partially-published upload never points the app at missing files).
//
// Usage:
//   node scripts/publish-images.mjs
//
// Publishing against a `*.firebasestorage.app` bucket refuses uploads when the
// SDK authenticates as a *personal* Google account (via `gcloud auth
// application-default login`) — GCS returns a misleading `403 accountDisabled`
// even with billing on and the billing account open. The supported path is a
// dedicated Firebase service account (JSON). Prefer that:
//
// 1. Firebase console → ⚙ Project settings → Service accounts →
//    "Generate new private key" → save it somewhere safe.
// 2. GOOGLE_APPLICATION_CREDENTIALS=/path/to/xxx.json npm run images:publish
//
// Grant that service account the role "Cloud Storage → Storage Object Admin"
// (roles/storage.objectAdmin) on the bucket if a bare upload 403s.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Storage } from '@google-cloud/storage'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const imagesDir = resolve(root, 'public/images/cocktails')

function classify(err) {
  const msg = err?.message ?? ''
  const code = err?.code ?? ''
  if (/accountDisabled|billing|disabled in state closed/i.test(msg)) {
    return 'Cloud Storage rejected the upload with an "account disabled" error.\n' +
      '  This almost always means the SDK is authenticating as your personal Google account\n' +
      '  (gcloud ADC), which is not a supported identity for a firebasestorage bucket.\n' +
      '  Use a dedicated Firebase service account instead:\n' +
      '    GOOGLE_APPLICATION_CREDENTIALS=/path/to/firebase-service-account.json npm run images:publish\n' +
      '  (Firebase console → ⚙ → Service accounts → Generate new private key.)'
  }
  if (/permissionDenied|403/i.test(msg)) {
    return 'Permission denied. Grant the linked service account "Storage Object Admin"\n' +
      ' (roles/storage.objectAdmin) on the bucket ' + bucket + ' and retry.'
  }
  return msg
}

// Bucket: --bucket wins, else VITE_FIREBASE_STORAGE_BUCKET from .env.local, else error.
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

const argBucket = process.argv.indexOf('--bucket') >= 0
  ? process.argv[process.argv.indexOf('--bucket') + 1]
  : null
const bucket = argBucket ?? bucketFromEnv()
if (!bucket) {
  console.error('No bucket. Pass --bucket <name> or set VITE_FIREBASE_STORAGE_BUCKET in .env.local.')
  process.exit(1)
}

const storage = new Storage()
const files = readdirSync(imagesDir).filter((f) => /\.(webp|png|jpg)$/.test(f))
const manifest = JSON.parse(readFileSync(resolve(root, 'src/domain/recipeImagesManifest.json'), 'utf8'))

async function upload(file, destination, opts) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await storage.bucket(bucket).upload(file, { destination, ...opts })
      return
    } catch (err) {
      if (attempt === 0 && /accountDisabled|disabled in state closed/.test(err?.message ?? '')) {
        console.error('\n' + classify(err) + '\n')
      }
      if (attempt === 1) throw new Error(classify(err) + '\n\n(raw: ' + err?.message + ')')
    }
  }
}

console.log(`Uploading ${files.length} image(s) to gs://${bucket}/cocktails/ …`)
for (const f of files) {
  await upload(resolve(imagesDir, f), `cocktails/${f}`, {
    gzip: false,
    cacheControl: 'public, max-age=31536000, immutable',
    contentType: f.endsWith('.png') ? 'image/png' : 'image/webp',
  })
  console.log('  ✓', f)
}

// Manifest last, so a partial upload never advertises missing files.
await upload(resolve(root, 'src/domain/recipeImagesManifest.json'), 'cocktails/manifest.json', {
  gzip: true,
  cacheControl: 'public, max-age=300',
  contentType: 'application/json',
})
console.log('  ✓ manifest.json')

// The semantic catalog (metadata for the matcher) — the same JSON the app
// bundles, uploaded so new styles can be added without an app deploy.
await upload(resolve(root, 'src/domain/recipeImages.json'), 'cocktails/catalog.json', {
  gzip: true,
  cacheControl: 'public, max-age=300',
  contentType: 'application/json',
})
console.log('  ✓ catalog.json')
console.log('Done. The app merges this catalog + manifest over the bundled set at boot.')