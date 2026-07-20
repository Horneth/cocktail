// Verify the "Merge duplicates" flow end-to-end against the seeded build.
// Seed exposes White rum (Daiquiri) and Bourbon (Whiskey Sour, Old Fashioned)
// as catalog rows. Entering merge mode, selecting both, and confirming with a
// canonical name should collapse them into a single row (the catalog derives
// from the rewritten recipe text).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const PORT = 5097
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' }
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/cocktail\//, '/')
  if (p === '/' || p === '') p = '/index.html'
  let file = resolve(dist, '.' + p); let body
  try { body = await readFile(file) } catch { body = await readFile(resolve(dist, 'index.html')); file = 'index.html' }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }); res.end(body)
})
await new Promise((r) => server.listen(PORT, r))
const BASE = `http://localhost:${PORT}/cocktail/`

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const page = await ctx.newPage()
const errors = []
// Ignore environmental network noise (SW/resource fetches reset when the tiny
// static server races with navigation) — we only care about real app errors.
const isNoise = (t) => /Failed to load resource|ERR_CONNECTION_RESET/i.test(t)
page.on('console', (m) => m.type() === 'error' && !isNoise(m.text()) && errors.push(m.text()))
page.on('pageerror', (e) => !isNoise(String(e)) && errors.push(String(e)))
// The canonical name is entered through a window.prompt().
page.on('dialog', (d) => d.accept('Base whiskey'))

const results = []
const check = (name, ok) => { results.push([name, ok]); console.log(`${ok ? '✓' : '✗'} ${name}`) }

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Browse by spirit')

// Open My Bar.
await page.getByRole('link', { name: 'My Bar' }).click()
await page.waitForSelector('text=Merge duplicates')

const rowByLabel = (label) => page.locator('button', { hasText: new RegExp(`^${label}$`) })
await rowByLabel('White rum').first().waitFor()
check('White rum + Bourbon both present before merge',
  (await rowByLabel('White rum').count()) >= 1 && (await rowByLabel('Bourbon').count()) >= 1)

// Enter merge mode, select both, confirm.
await page.click('text=Merge duplicates')
await page.waitForSelector('text=Pick 2+ ingredients to merge')
await rowByLabel('White rum').first().click()
await rowByLabel('Bourbon').first().click()
await page.waitForSelector('text=Merge 2 into one')
if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/merge-mode.png` })
await page.getByRole('button', { name: 'Merge', exact: true }).click()

// After merge: one survivor row, the two originals gone.
await page.waitForSelector('text=Base whiskey')
await page.waitForFunction(() => !/\bWhite rum\b/.test(document.body.innerText))
check('survivor "Base whiskey" row present', (await rowByLabel('Base whiskey').count()) >= 1)
check('"White rum" row gone', (await rowByLabel('White rum').count()) === 0)
check('"Bourbon" row gone', (await rowByLabel('Bourbon').count()) === 0)

// Reload to prove the rewrite persisted to IndexedDB.
// Navigate fresh to the bar route to prove the rewrite persisted to IndexedDB.
await page.goto(BASE + '#/bar', { waitUntil: 'networkidle' })
await page.waitForSelector('text=Merge duplicates')
check('merge persisted across reload', (await rowByLabel('Base whiskey').count()) >= 1)

check('no console/page errors', errors.length === 0)
if (errors.length) console.log('  errors:', errors)

await browser.close()
server.close()
const failed = results.filter(([, ok]) => !ok)
console.log(failed.length ? `\nFAILED ${failed.length}` : '\nALL PASSED')
process.exit(failed.length ? 1 : 0)
