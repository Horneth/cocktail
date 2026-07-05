// Verify the "My Bar" inventory + makeable filter end-to-end against the seeded
// build: seed has a shared Simple Syrup and Daiquiri/Whiskey Sour/Old Fashioned/
// Margarita. With an empty bar nothing is makeable; add White rum → only the
// Daiquiri (rum + assumed staples + auto-made syrup) becomes makeable.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const shots = resolve(dirname(fileURLToPath(import.meta.url)), 'shots')
const PORT = 5096
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
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))
const bodyText = async () => (await page.locator('body').innerText())

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Cocktails')

// No banner when the bar is empty
const bannerBefore = await page.locator('text=you can make right now').count()
console.log('• no makeable banner with empty bar:', bannerBefore === 0)

// Open My Bar and add "White rum"
await page.click('a[aria-label="My Bar"]')
await page.waitForSelector('text=My Bar')
await page.fill('input[placeholder="Search or add a bottle…"]', 'rum')
// the seed uses "White rum" — tick it in the list
await page.waitForSelector('text=White rum')
await page.locator('label', { hasText: 'White rum' }).locator('input[type=checkbox]').click()
await page.waitForTimeout(200)
const count = await bodyText()
console.log('• bar shows a bottle count:', /1 bottle/.test(count))
await page.screenshot({ path: resolve(shots, '28-mybar.png') })

// Back to home — banner should now appear
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=you can make right now', { timeout: 4000 })
console.log('• makeable banner appears after adding a bottle: true')
await page.screenshot({ path: resolve(shots, '29-home-banner.png') })

// Follow the banner into the makeable browse view
await page.click('text=you can make right now')
await page.waitForSelector('text=Only what I can make', { timeout: 4000 })
await page.waitForTimeout(400)
const listText = await bodyText()
const hasDaiquiri = /Daiquiri/.test(listText)
const hasNegroniish = /Whiskey Sour|Old Fashioned|Margarita/.test(listText)
console.log('• makeable view shows Daiquiri:', hasDaiquiri)
console.log('• makeable view hides drinks needing other bottles:', !hasNegroniish)
await page.screenshot({ path: resolve(shots, '30-makeable.png') })

// Toggle off → all cocktails visible again
await page.locator('label', { hasText: 'Only what I can make' }).locator('input[type=checkbox]').click()
await page.waitForTimeout(300)
const allText = await bodyText()
console.log('• toggling off restores the full list:', /Whiskey Sour/.test(allText) && /Margarita/.test(allText))

const ok = bannerBefore === 0 && hasDaiquiri && !hasNegroniish && /Whiskey Sour/.test(allText)
console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close(); server.close()
process.exit(errors.length || !ok ? 1 : 0)
