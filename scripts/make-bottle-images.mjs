// Generate the My Bar bottle portraits.
//
// Two layers, both static assets committed to the repo and precached by the
// service worker — no runtime generation, no sign-in, no per-user cost:
//
//   1. Real-bottle portraits → public/bottles/b/<slug>.webp
//      Content-addressed by the bottle's NAME (poolKey.mjs slug rules — the
//      same key the app looks up at runtime, so they can never drift). One
//      portrait per actual bottle: Campari looks like Campari. The list lives
//      in scripts/bottles.json; new bottles are one JSON entry plus a rerun.
//      These are renderings of real bottles in one consistent studio style —
//      garbled micro-text on labels is expected and unreadable at card size.
//
//   2. Category portraits → public/bottles/<category>.webp
//      The generic, unbranded studio bottle per family. The FALLBACK for any
//      bottle without its own portrait: correct for the family, never the
//      brand (which is exactly why a real portrait is generated per bottle).
//
// Usage:
//   GOOGLE_API_KEY=... node scripts/make-bottle-images.mjs --bottles            # all of bottles.json
//   GOOGLE_API_KEY=... node scripts/make-bottle-images.mjs --bottle "Kahlúa"    # one real bottle (with its bottles.json hint)
//   GOOGLE_API_KEY=... node scripts/make-bottle-images.mjs                      # the category fallbacks
//   ... --force                                                                 # redo existing files
//
// The key is an AI Studio key passed via env (never committed — same rule as
// scripts/generate-images.mjs).

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { slugifyPoolKey, sanitizeDrinkName } from '../src/domain/poolKey.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public/bottles')
const model = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-2.5-flash-image'
const apiKey = process.env.GOOGLE_API_KEY

const argv = process.argv.slice(2)
const only = []
let force = false
let bottlesBatch = false
const bottleNames = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--only') only.push(argv[++i])
  else if (argv[i] === '--force') force = true
  else if (argv[i] === '--bottles') bottlesBatch = true
  else if (argv[i] === '--bottle') bottleNames.push(argv[++i])
}
if (only.length && force) {
  console.error('--only already regenerates just those; --force is for the full set. Pick one.')
  process.exit(1)
}

// ── Mode 1: category fallbacks (the generic family portrait) ────────────────
// `subject` describes the family archetype — shape and liquid, never a brand.
// The style block is shared so the set reads as one photo series.
const CATEGORY_SPECS = [
  { key: 'gin', subject: 'a London dry gin bottle — tall and slender with a long neck, clear liquid' },
  { key: 'vodka', subject: 'a vodka bottle — tall and frosted, crystal-clear liquid' },
  { key: 'rum', subject: 'a dark rum bottle — round shoulders, deep amber liquid' },
  { key: 'cachaca', subject: 'a cachaça bottle — tall clear glass, colourless sugar-cane spirit, a simple rustic paper label' },
  { key: 'whiskey', subject: 'a bourbon whiskey bottle — square shoulders, broad body, deep amber liquid' },
  { key: 'tequila', subject: 'a tequila bottle — short and broad with a stubby neck, pale straw liquid' },
  { key: 'mezcal', subject: 'a mezcal bottle — short dark glass with smoky amber liquid, an artisanal feel' },
  { key: 'agave', subject: 'an agave spirit bottle — rustic, pale green-gold liquid, agave-leaf embossing' },
  { key: 'brandy', subject: 'a brandy bottle — decanter style with a very short neck, deep amber liquid' },
  { key: 'cognac', subject: 'a cognac bottle — elegant decanter silhouette, warm copper liquid' },
  { key: 'pisco', subject: 'a pisco bottle — tall and slender, clear grape brandy' },
  { key: 'wine', subject: 'a sweet vermouth bottle — dark glass wine bottle, deep ruby liquid' },
  { key: 'aperitivo', subject: 'an Italian bitter aperitivo bottle — squat dark glass, vivid scarlet liquid' },
  { key: 'liqueur', subject: 'an orange liqueur bottle — square-shouldered, warm amber liquid' },
  { key: 'other', subject: 'an unbranded clear glass bottle — neutral and minimal, could hold anything, plain paper label' },
]

// The shared style contract. The app's own paper colour so a photo sits flush
// with the cards around it, and one light direction so the grid reads as a
// shelf. (The blank-label clause belongs to the category fallbacks only — a
// real-bottle portrait exists to show the real label.)
const STYLE =
  'Studio product photograph of a single unopened bottle, standing centered and upright, ' +
  'full bottle in frame with generous margin. Warm cream seamless background (#F6F4EF), ' +
  'soft diffused daylight from the upper left, a gentle soft shadow directly beneath the ' +
  'bottle. Photorealistic, crisp, calm and minimal.'
const BLANK_LABEL = 'Completely blank minimalist paper label, absolutely no text, no letters, no numbers, no logos, no branding.'

// ── Mode 2/3: real-bottle portraits ─────────────────────────────────────────
// File name = pool slug of `name` = the key the app looks up (bottleVisual.ts).
const bottleSpec = (name) => {
  const slug = slugifyPoolKey(name)
  return slug ? `b/${slug}` : null
}

function realBottlePrompt(entry) {
  // The name is DATA, not instructions — same rule as the drink pool.
  const name = sanitizeDrinkName(entry.name)
  const hint = entry.hint ? ` ${sanitizeDrinkName(entry.hint)}.` : ''
  return (
    `Studio product photograph of a real, unopened bottle of ${name}. ${hint || ''} ` +
    `Show the actual bottle as it looks in reality — its true shape, colour and its label with the brand's own look. ` +
    `${STYLE}`
  )
}

function categoryPrompt(spec) {
  return `Studio product photograph of ${spec.subject}. ${BLANK_LABEL} ${STYLE}`
}

if (!apiKey) {
  console.error('Set GOOGLE_API_KEY (AI Studio key) to run the bottle seeder.')
  process.exit(1)
}

async function generateSquare(prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { imageSize: '1K', aspectRatio: '1:1' },
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

async function writePortrait(relPath, raw) {
  const webp = await sharp(raw).resize(640, 640, { fit: 'cover' }).webp({ quality: 82 }).toBuffer()
  const out = resolve(outDir, `${relPath}.webp`)
  writeFileSync(out, webp)
  console.log('  ✓', `${relPath}.webp`, `(${Math.round(webp.length / 1024)} KB)`)
}

// The real-bottle set: scripts/bottles.json. The file name derives from
// `name`, so the JSON is the contract with what the app resolves at runtime.
const bottleJson = JSON.parse(readFileSync(resolve(root, 'scripts/bottles.json'), 'utf8'))
const bottleEntries = bottleJson.bottles

// Work out the job list.
let jobs = []  // {rel, prompt, existing}
if (bottleNames.length || bottlesBatch) {
  if (only.length) {
    console.error('--only applies to the category fallbacks; use --bottle "Name" for one real bottle.')
    process.exit(1)
  }
  const wanted = bottleNames.length
    ? bottleNames.map((name) => {
        const rel = bottleSpec(name)
        if (!rel) {
          console.error(`No usable slug for "${name}".`)
          process.exit(1)
        }
        return { rel, entry: bottleEntries.find((e) => slugifyPoolKey(e.name) === slugifyPoolKey(name)) ?? { name } }
      })
    : bottleEntries.map((entry) => {
        const rel = bottleSpec(entry.name)
        if (!rel) {
          console.error(`No usable slug for "${entry.name}" — fix the name in bottles.json.`)
          process.exit(1)
        }
        return { rel, entry }
      })
  for (const { rel, entry } of wanted) {
    jobs.push({ rel, prompt: realBottlePrompt(entry), existing: existsSync(resolve(outDir, `${rel}.webp`)) })
  }
} else {
  if (only.length) {
    const known = new Set(CATEGORY_SPECS.map((s) => s.key))
    const unknown = only.filter((o) => !known.has(o))
    if (unknown.length) {
      console.error(`Unknown key(s): ${unknown.join(', ')}`)
      process.exit(1)
    }
  }
  for (const spec of only.length ? CATEGORY_SPECS.filter((s) => only.includes(s.key)) : CATEGORY_SPECS) {
    jobs.push({ rel: spec.key, prompt: categoryPrompt(spec), existing: existsSync(resolve(outDir, `${spec.key}.webp`)) })
  }
}
if (!force) {
  // Incremental by default: entries whose portrait already exists are skipped
  // (like the drink-pool seeder), so adding bottles to the JSON and rerunning
  // only pays for the new ones. --force redoes everything in the job list.
  jobs = jobs.filter((j) => {
    if (!j.existing) return true
    console.log('  =', `${j.rel}.webp`, '(already have it)')
    return false
  })
  if (!jobs.length) {
    console.log('Nothing to generate — every portrait already exists. Pass --force to redo.')
    process.exit(0)
  }
}

mkdirSync(resolve(outDir, 'b'), { recursive: true })
const what = bottleNames.length
  ? `1 real-bottle portrait (${bottleNames[0]})`
  : bottlesBatch
    ? `${jobs.length} real-bottle portraits`
    : `${jobs.length} category fallbacks`
console.log(`Generating ${what} with ${model} → public/bottles/ …`)
let done = 0
for (const job of jobs) {
  try {
    await writePortrait(job.rel, await generateSquare(job.prompt))
    done += 1
  } catch (err) {
    console.error('  ✗', job.rel, err instanceof Error ? err.message : err)
  }
}
console.log(`Done. ${done} written to public/bottles/ — eyeball them before committing.`)