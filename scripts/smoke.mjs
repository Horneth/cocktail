// End-to-end smoke check. Drives the production build in a real browser and
// screenshots each primary screen, then exercises the backup round trip.
//
// This replaces sixteen throwaway verify-*.mjs scripts, one per feature, that
// all drove the pre-redesign UI, all hardcoded a browser path that only existed
// on one machine, and none of which had been run in months. One script that
// stays true is worth more than sixteen that rot.
//
//   npx playwright install chromium      # once per machine (caches outside the repo)
//   npm run build && npm run preview     # in another shell (serves :4173)
//   node scripts/smoke.mjs
//
// Playwright IS a devDependency, but the workflow sets
// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 on `npm ci`, so no CI run — none of which
// opens a browser — pays for the ~100 MB download. Locally the browsers live in
// a shared cache (~/Library/Caches/ms-playwright), so every worktree and every
// reinstall reuses the same one.
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

// Every URL the page asks for, so we can prove the Firebase SDK chunk is NOT
// among them. Deliberately anchored on `assets/firebase-` so it doesn't also
// match `assets/firebaseAI-*.js` — that one is our own small shim, and it is
// precached, so it always loads.
const requested = []
page.on('request', (r) => requested.push(r.url()))
const firebaseSdkLoaded = () => requested.filter((u) => /assets\/firebase-[^/]*\.js/.test(u))

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

// ── Is this even the build we just made? ────────────────────────────────────
// `vite preview` silently moves to 4174 when 4173 is taken, so a forgotten
// server from another checkout will happily answer here and every check below
// grades the wrong build. That is worse than a failure: it can pass. Compare
// the served entry bundle against the one on disk before trusting anything.
{
  const { readFileSync } = await import('node:fs')
  const onDisk = readFileSync('dist/index.html', 'utf8').match(/assets\/index-[^"']+\.js/)?.[0]
  const served = (await (await fetch(BASE)).text()).match(/assets\/index-[^"']+\.js/)?.[0]
  if (onDisk && served && onDisk !== served) {
    console.error(
      `\n${BASE} is serving a different build than dist/.\n` +
        `  served:  ${served}\n  on disk: ${onDisk}\n` +
        'Another `vite preview` is probably holding the port. Kill it, or point this\n' +
        'script at the right one:  SMOKE_BASE=http://localhost:4174/ node scripts/smoke.mjs',
    )
    await browser.close()
    process.exit(2)
  }
}

// ── The app shell ───────────────────────────────────────────────────────────
await go('#/')
await shot('01-recipes')
const homeBefore = await page.locator('a[href^="#/recipe/"]').count()
check('recipes tab lists seeded recipes', homeBefore > 0, `${homeBefore} recipes`)
// The tab bar is buttons + aria-labels, not links.
check('tab bar has the two tabs', (await page.locator('button[aria-label="Recipes"]').isVisible()) && (await page.locator('button[aria-label="My Bar"]').isVisible()))
check('no separate search/browse tabs', (await page.locator('button[aria-label="Search"]').count() + await page.locator('button[aria-label="Browse"]').count()) === 0)

// Settings is the third tab (a button like the others) — if it regresses, the
// screen is unreachable without typing a URL.
const gear = page.locator('button[aria-label="Settings"]')
check('settings tab is on the recipes screen', await gear.isVisible())
await gear.click()
await page.waitForTimeout(500)
check('gear opens Settings', (await page.locator('h1').first().textContent())?.trim() === 'Settings')
await go('#/') // back to recipes; the rest of the shell walk starts from there

// Each primary screen owns its labelled add button (Recipe on Recipes, Bottle
// on My Bar) — there is no FAB and no add-choice sheet to get lost in.
await page.locator('button', { hasText: /^Recipe$/ }).click()
await page.waitForTimeout(500)
check('the Recipe button opens the manual editor', (await page.locator('input[placeholder^="e.g. Midnight"]').count()) === 1)

for (const [hash, name] of [
  ['#/bar', '05-bar'],
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

// A pushed screen must load at the top. Hash navigation is same-document, so
// the scroll position survives the route change unless the router resets it —
// and the reset only works while the document (not #root) is the scroller, a
// contract theme.css documents. Scroll deep, tap a card raw (evaluate, so
// Playwright's own scroll-into-view can't rescue the assertion), and require
// both scrollers to read zero on the detail page.
await go('#/')
await page.evaluate(() => {
  const root = document.getElementById('root')
  if (root && root.scrollHeight > root.clientHeight) root.scrollTop = root.scrollHeight
  else window.scrollTo(0, document.documentElement.scrollHeight)
  return { root: root?.scrollTop ?? 0, win: window.scrollY }
})
{
  const scrolled = await page.evaluate(() => ({
    root: document.getElementById('root')?.scrollTop ?? 0,
    win: window.scrollY,
  }))
  check(
    'the recipes list actually scrolls before the tap',
    scrolled.root > 0 || scrolled.win > 0,
    JSON.stringify(scrolled),
  )
  await page.locator('a[href^="#/recipe/"]').nth(2).evaluate((el) => el.click())
  await page.waitForTimeout(500)
  const after = await page.evaluate(() => ({
    root: document.getElementById('root')?.scrollTop ?? 0,
    win: window.scrollY,
  }))
  check('a pushed recipe loads at the top', after.win === 0 && after.root === 0, JSON.stringify(after))
  await shot('09b-recipe-top')
}

// Tags are a filter, not decoration — and the rules run both ways, like every
// bottle↔recipe question here: the chip row under the spirit chips narrows the
// library, and a detail page's tag chips link into that same filter.
await go('#/')
const allCount = await page.locator('a[href^="#/recipe/"]').count()
await page.locator('button', { hasText: 'Sour' }).first().click()
await page.waitForTimeout(500)
check(
  'a tag chip narrows the library',
  page.url().includes('tags=') && (await page.locator('a[href^="#/recipe/"]').count()) < allCount,
)
await go('#/')
await page.locator('a[href^="#/recipe/"]').first().click()
const chipTag = (await page.locator('a[href*="tags="]').first().getAttribute('href'))?.match(/tags=([^&]+)/)?.[1]
await page.locator('a[href*="tags="]').first().click()
await page.waitForTimeout(500)
check(
  'a detail tag chip filters too',
  !!chipTag && page.url().includes(`tags=${chipTag}`),
)

// ── A syrup is a recipe too — the whole path, both directions ───────────────
// The Syrups chip shows the mixers; a syrup's detail page carries a styled
// "Used in" list (a redesign regression once stripped those styles); and its
// tag chip lands on a filtered page that actually has content.
await go('#/')
await page.locator('button', { hasText: 'Syrups' }).first().click()
await page.waitForTimeout(500)
const syrupCards = await page.locator('a[href^="#/recipe/"]').count()
check(
  'the Syrups chip lists the mixers',
  syrupCards === 2 && syrupCards < homeBefore,
  `${syrupCards} mixers`,
)
await page.locator('a[href^="#/recipe/"]').first().click()
await page.waitForTimeout(600)
const usedInStyle = await page
  .locator('a[href^="#/recipe/"]')
  .first()
  .evaluate((el) => getComputedStyle(el).borderRadius)
check('a syrup’s Used in chips are styled', usedInStyle === '999px', usedInStyle)
await page.locator('a[href*="tags="]').first().click()
await page.waitForTimeout(500)
check(
  'a syrup tag filters to the syrups',
  page.url().includes('tags=syrup') && (await page.locator('a[href^="#/recipe/"]').count()) === syrupCards,
)

// ── Pool references degrade to the spirit tile when the pool can't serve ────
// The seed classics store `gen:<key>` refs. Whatever the pool answers (here:
// nothing — the seeder hasn't run against this bucket), every reference must
// resolve or fall back: no half-loaded or broken image may remain on screen,
// and the fallback has to be the tile, not a raw `gen:` URL in an img src.
await go('#/')
await page.waitForTimeout(800)
check(
  'pool refs render or fall back cleanly',
  await page.evaluate(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0)),
)
// The pool route must MATCH the storage download URLs (whose object path is
// percent-encoded: /o/generated%2Fv1%2F…) so photos land in the SW's SWR cache
// and repeat visits render instantly instead of revalidating over the network.
const poolCacheHits = await page.evaluate(async () =>
  (await (await caches.open('cocktail-images-pool-v2')).keys()).length,
)
check('pool photos are cached by the service worker', poolCacheHits > 0)

// ── Cloud AI stays out of the way until you ask for it ──────────────────────
// The whole point of the sign-in gate is that an offline user never pays for
// it. My Bar's add sheet and the recipe editor both call useAuth (which does not
// boot Firebase unless you've signed in before or just clicked sign in), so if
// that ever regresses the ~350 KB SDK chunk shows up in the walks above and here.
await go('#/bar')
await go('#/new')
check(
  'Firebase SDK is not loaded for a signed-out user',
  firebaseSdkLoaded().length === 0,
  firebaseSdkLoaded().join(' | '),
)

// The bring-your-own-key field is gone for good — a password box on this screen
// means the retired path came back.
await go('#/settings')
check('settings has no API key field', (await page.locator('input[type="password"]').count()) === 0)
check('settings still offers the AI section', (await page.locator('text=/AI features/i').count()) > 0)

// Signed out, the manual recipe editor is the whole recipe path: it must render
// its blank form — no sign-in wall, no dead end — and be ready to Save.
await go('#/new')
check(
  'the manual editor renders signed out',
  (await page.locator('input[placeholder^="e.g. Midnight"]').count()) === 1,
)
check('new recipe Save is reachable', (await page.locator('button', { hasText: 'Save recipe' }).count()) === 1)
await shot('11-build-signed-out')

// My Bar's manual path is the other half of "signed out is the whole product":
// adding a bottle must never need AI, a sign-in, or a network. The add starts
// at My Bar's own Bottle button, which opens the sheet directly.
await go('#/bar')
await page.locator('button', { hasText: /^Bottle$/ }).click()
await page.waitForTimeout(500)
check(
  'A bottle opens the bottle add on My Bar',
  await page.locator('input[aria-label="Search or type a bottle"]').isVisible(),
)
await page.locator('input[aria-label="Search or type a bottle"]').fill('Smith & Cross')
await page.locator('button[aria-label="Add Smith & Cross"]').click()
await page.locator('button', { hasText: /^Add 1 bottle/ }).click()
await page.waitForTimeout(600)
check(
  'manual bottle add works signed out',
  (await page.locator('button', { hasText: 'Smith & Cross' }).count()) > 0,
)
// The bottle is a rum, so it must land under the Rum group rather than "Other" —
// that is the stored category doing its job.
check('the new bottle is categorized', (await page.locator('text=/^Rum$/').count()) > 0)
// Each row's whole visual is the category silhouette: a bottle shape in the
// category colour on the tinted chip — not a bare square.
check(
  'bottle rows carry a silhouette glyph',
  (await page.locator('button', { hasText: 'Smith & Cross' }).locator('svg').count()) > 0,
)

// A stocked syrup is the same recipe in another view: it groups under Syrups
// with the drawn bottle, and its sheet links back to the recipe page.
// (The previous add closed the sheet; open it again, like a person would.)
await page.locator('button', { hasText: /^Bottle$/ }).click()
await page.waitForTimeout(500)
await page.locator('input[aria-label="Search or type a bottle"]').fill('Simple Syrup')
await page.locator('button', { hasText: 'Simple Syrup' }).first().click()
await page.locator('button', { hasText: /^Add 1 bottle/ }).click()
await page.waitForTimeout(600)
check('a stocked syrup groups under Syrups', (await page.locator('text=/^Syrups$/').count()) > 0)
await page.locator('button', { hasText: 'Simple Syrup' }).first().click()
await page.waitForTimeout(400)
check(
  'the syrup bottle links back to its recipe',
  (await page.locator('a', { hasText: 'View recipe' }).count()) === 1,
)
await go('#/bar')
await shot('12-bar-manual-add')

// ── Bottles and recipes point at each other ─────────────────────────────────
// No seeded recipe names Smith & Cross, so this only works if both directions
// go through the availability rules: the bottle lists the rum drinks it covers,
// and an ingredient line leads back to My Bar (to the bottle, or to adding it).
await page.locator('button', { hasText: 'Smith & Cross' }).click()
await page.waitForTimeout(400)
check(
  'a bottle lists the drinks it pours, family included',
  (await page.locator('text=/Pours in [1-9]/').count()) > 0,
)
await shot('13-bottle-sheet')

await go('#/')
await page.locator('a[href^="#/recipe/"]').first().click()
await page.waitForTimeout(400)
check(
  'a recipe links its ingredients into My Bar',
  (await page.locator('a[href^="#/bar"]').count()) > 0,
)
check(
  'the recipe screen has no bottom CTA',
  (await page.locator('button', { hasText: 'Start making' }).count()) === 0,
)

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
  // The backup holds every recipe — home and backup agree now that syrups show
  // on the Recipes screen too.
  check(
    'backup carries the library',
    backup.data.recipes.length >= homeBefore,
    `${backup.data.recipes.length} recipes, ${backup.data.bars.length} bars`,
  )
  // PORTABLE_SETTINGS is an allowlist so credentials and session state can't
  // ride along into a file that ends up in email or cloud storage.
  const serialized = JSON.stringify(backup)
  check(
    'backup omits credentials and session state',
    !serialized.includes('geminiKey') && !serialized.includes('signedIn'),
  )

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
