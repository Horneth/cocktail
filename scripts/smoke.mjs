// End-to-end smoke check. Drives the production build in a real browser and
// screenshots each primary screen, then exercises the backup round trip.
//
// This replaces sixteen throwaway verify-*.mjs scripts, one per feature, that
// all drove the pre-redesign UI, all hardcoded a browser path that only existed
// on one machine, and none of which had been run in months. One script that
// stays true is worth more than sixteen that rot.
//
//   npm i -D playwright                  # once; not a repo dependency
//   npm run build && npm run preview     # in another shell (serves :4173)
//   node scripts/smoke.mjs
//
// Playwright is deliberately NOT in package.json: it drags a browser download
// into every `npm ci`, including CI runs that never open a browser. It stays a
// one-command local install.
//
// Not part of `npm test` — it needs a browser and a running server.
import { mkdirSync } from 'node:fs'

let chromium
try {
  ;({ chromium } = await import('playwright'))
} catch {
  console.error('Playwright is not installed. Run:  npm i -D playwright')
  process.exit(2)
}

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:4173/'
const OUT = 'scripts/shots'
mkdirSync(OUT, { recursive: true })

// The old scripts pinned executablePath to /opt/pw-browsers/chromium-1194/…,
// which existed on exactly one machine. Use Playwright's own browser if it has
// been installed, otherwise fall back to the Chrome already on the system, so
// this runs without a 150 MB download.
async function launch() {
  try {
    return await chromium.launch()
  } catch {
    console.log('(no Playwright browser installed — falling back to system Chrome)')
    return await chromium.launch({ channel: 'chrome' })
  }
}

const browser = await launch()
const context = await browser.newContext({
  viewport: { width: 430, height: 900 },
  deviceScaleFactor: 2,
  acceptDownloads: true,
})
const page = await context.newPage()

const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

const failures = []
function check(name, ok, detail = '') {
  console.log(`${ok ? '  ok' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

async function shot(name) {
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/${name}.png` })
}

// The app is hash-routed, so page.goto() between two '#/…' URLs is a same-
// document navigation: the browser never reloads and React state (an open
// sheet, say) survives into the "next" screen. Reload explicitly so each step
// starts clean.
async function go(hash) {
  await page.goto(BASE + hash, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
}

// ── The app shell ───────────────────────────────────────────────────────────
await go('#/')
await shot('01-home')
const homeBefore = await page.locator('a[href^="#/recipe/"]').count()
check('home lists seeded recipes', homeBefore > 0, `${homeBefore} recipes`)
// The tab bar is buttons + aria-labels, not links.
check('tab bar is present', await page.locator('button[aria-label="Browse"]').first().isVisible())

await page.locator('button[aria-label="Add"]').click()
await shot('02-add-sheet')

for (const [hash, name] of [
  ['#/search', '03-search'],
  ['#/browse', '04-browse'],
  ['#/bar', '05-bar'],
  ['#/import', '06-import'],
  ['#/new', '07-build'],
  ['#/settings', '08-settings'],
]) {
  await go(hash)
  await shot(name)
}

await go('#/')
const firstRecipe = page.locator('a[href^="#/recipe/"]').first()
await firstRecipe.click()
await shot('09-recipe')
check('recipe detail shows ingredients', (await page.locator('text=/oz|ml/').count()) > 0)

// ── Backup round trip ───────────────────────────────────────────────────────
// The reason this feature exists is the origin move, so a green unit test isn't
// enough — the file has to actually leave the browser and come back.
await go('#/settings')

const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 15_000 }).catch(() => null),
  page.locator('button', { hasText: 'Export backup' }).click(),
])

check('export produces a download', Boolean(dl), dl ? dl.suggestedFilename() : 'no download event')

if (dl) {
  const path = await dl.path()
  const { readFileSync } = await import('node:fs')
  const backup = JSON.parse(readFileSync(path, 'utf8'))
  check('backup is a cocktail envelope', backup.app === 'cocktail' && backup.version === 1)
  // More rows than the home list: components (syrups) are recipes too.
  check(
    'backup carries the library',
    backup.data.recipes.length >= homeBefore,
    `${backup.data.recipes.length} recipes, ${backup.data.bars.length} bars`,
  )
  check('backup omits the API key', !JSON.stringify(backup).includes('geminiKey'))

  // Wipe the library, then restore from the exported file and confirm it returns.
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases()
    await Promise.all(
      dbs.map((d) => new Promise((res) => {
        const req = indexedDB.deleteDatabase(d.name)
        req.onsuccess = req.onerror = req.onblocked = () => res()
      })),
    )
  })
  page.once('dialog', (d) => d.accept())
  await go('#/settings')
  await page.locator('input[type="file"]').setInputFiles(path)
  await page.waitForTimeout(1200)
  await go('#/')
  await page.waitForTimeout(600)
  const restored = await page.locator('a[href^="#/recipe/"]').count()
  check(
    'import restores the library exactly',
    restored === homeBefore,
    `${restored} on home, expected ${homeBefore}`,
  )
  await shot('10-after-restore')
}

check('no console errors', errors.length === 0, errors.join(' | '))

await browser.close()
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(', ')}` : '\nall checks passed')
process.exit(failures.length ? 1 : 0)
