// Verify the spirit-mosaic home: tiles render, tapping one opens the per-spirit
// list, tag filter works there, and global search on home returns results.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const shots = resolve(root, 'scripts/shots')
const PORT = 5091
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' }
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]).replace(/^\/cocktail\//, '/')
  if (p === '/' || p === '') p = '/index.html'
  let file = resolve(dist, '.' + p)
  let body
  try { body = await readFile(file) } catch { body = await readFile(resolve(dist, 'index.html')); file = 'index.html' }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(body)
})
await new Promise((r) => server.listen(PORT, r))
const BASE = `http://localhost:${PORT}/cocktail/`

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

// 1. Mosaic renders
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=All cocktails')
const tileCount = await page.locator('a[href^="#/spirit/"]').count()
console.log('• mosaic tiles:', tileCount)
await page.screenshot({ path: resolve(shots, '18-mosaic.png') })

// 2. Tap Whiskey tile -> per-spirit list with the 2 whiskey drinks
await page.click('text=Whiskey')
await page.waitForSelector('h1:has-text("Whiskey")')
const inWhiskey = await page.locator('a[href^="#/recipe/"]').count()
const hasOF = await page.locator('text=Old Fashioned').count()
const hasWS = await page.locator('text=Whiskey Sour').count()
console.log('• whiskey list count:', inWhiskey, '| Old Fashioned+Whiskey Sour:', hasOF > 0 && hasWS > 0)
await page.screenshot({ path: resolve(shots, '19-spirit-whiskey.png') })

// 3. Tag filter within the spirit view
const classic = page.locator('button:has-text("#classic")')
if (await classic.count()) {
  await classic.first().click()
  await page.waitForTimeout(150)
  console.log('• tag filter applied, results:', await page.locator('a[href^="#/recipe/"]').count())
  await classic.first().click()
}

// 4. Global search from home
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.fill('input[placeholder*="Search"]', 'lime')
await page.waitForTimeout(200)
const searchResults = await page.locator('a[href^="#/recipe/"]').count()
console.log('• home search "lime" results:', searchResults)

console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close()
server.close()
process.exit(errors.length || !(hasOF > 0 && hasWS > 0) || searchResults < 1 ? 1 : 0)
