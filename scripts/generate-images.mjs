// Generate the curated cocktail-image catalog into `public/images/cocktails/`.
//
// Uses YOUR OWN Gemini API key (AI Studio) DIRECTLY — NOT Firebase AI Logic — so
// the project's template-only mode does not apply here. Run it on a laptop, review
// the output, then publish to Firebase Storage (see `scripts/publish-images.mjs`).
//
// Usage:
//   GOOGLE_API_KEY=... node scripts/generate-images.mjs            # all slots
//   GOOGLE_API_KEY=... node scripts/generate-images.mjs --only mai-tai   # one slot
//   GOOGLE_API_KEY=... node scripts/generate-images.mjs --model gemini-3.1-flash-image
//
// Re-use for a new style:
//   1. Append a row to `src/domain/recipeImages.ts` (copy one, change slug/glass/
//      keywords/cue/sample).
//   2. Run `--only <new-slug>` to render just that shot.
//   3. Review, re-run if needed, publish. No full regeneration, no app redeploy
//      (the app merges a Storage-hosted manifest over the bundled catalog).

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public/images/cocktails')
const outManifest = resolve(root, 'src/domain/recipeImagesManifest.json')

const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3.1-flash-image'
const apiKey = process.env.GOOGLE_API_KEY
if (!apiKey) {
  console.error('Set GOOGLE_API_KEY (AI Studio key) to run the image generator.')
  process.exit(1)
}

// The fixed style contract — identical for every slot. This is what keeps the
// whole catalog looking like one photographer shot it. Keep it in sync with the
// description text the app's matcher uses (see src/domain/recipeImages.ts).
const STYLE = `Editorial cocktail photography, centered close shot, shallow depth of field,
warm blurred bar-back bokeh, soft rim light, the drink prominent in its glass on a
clean warm tabletop. One glass only. No text, no labels, no hands, no logos, no
props, no brand names, no people. Vertical 3:4 composition.`

function buildPrompt(slot) {
  return `${STYLE}

Render: ${slot.label} — ${slot.description} ${slot.cue}.`
}

async function generateOne(slot) {
  const prompt = buildPrompt(slot)
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
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
  if (!part?.inlineData?.data) throw new Error(`No image returned for ${slot.slug}.`)
  return {
    mimeType: part.inlineData.mimeType,
    base64: part.inlineData.data,
  }
}

function parseArgs(argv) {
  const only = []
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--only') only.push(argv[i + 1])
  }
  return { only: only.filter(Boolean) }
}

// Import the catalog from the repo's JSON (the single source of truth).
async function loadCatalog() {
  const json = readFileSync(resolve(root, 'src/domain/recipeImages.json'), 'utf8')
  return JSON.parse(json)
}

mkdirSync(outDir, { recursive: true })

const catalog = await loadCatalog()
const { only } = parseArgs(process.argv)
const targets = only.length ? catalog.filter((s) => only.includes(s.slug)) : catalog
if (only.length && targets.length !== only.length) {
  const missing = only.filter((s) => !catalog.some((c) => c.slug === s))
  console.error(`Unknown slug(s): ${missing.join(', ')} — check src/domain/recipeImages.ts`)
  process.exit(1)
}

console.log(`Generating ${targets.length} image(s) with ${model}…`)
const manifest = {}
for (const slot of targets) {
  try {
    const { mimeType, base64 } = await generateOne(slot)
    const ext = mimeType === 'image/png' ? 'png' : 'webp'
    const file = `${slot.slug}.${ext}`
    writeFileSync(resolve(outDir, file), Buffer.from(base64, 'base64'))
    manifest[slot.slug] = file
    console.log('  ✓', file)
  } catch (err) {
    console.error('  ✗', slot.slug, err.message)
  }
}
// Bundled manifest: slug -> file, committed so the app knows each slot's file
// name offline. Merged, so a --only run never wipes entries it didn't touch.
let existing = {}
try {
  existing = JSON.parse(readFileSync(outManifest, 'utf8'))
} catch {
  /* first run */
}
writeFileSync(
  outManifest,
  JSON.stringify({ ...existing, ...manifest }, null, 2) + '\n',
)
console.log('Manifest → src/domain/recipeImagesManifest.json')