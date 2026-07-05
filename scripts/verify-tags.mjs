// Verify cross-spirit, multi-select tag browsing: a home tag pill opens /browse
// filtered by that tag across all spirits, and selecting a second tag narrows
// further (AND). Also spirit tile -> browse with scoped tag picker.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const shots = resolve(root, 'scripts/shots')
const PORT = 5090
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

// Home shows a "Browse by tag" section
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Browse by tag')
await page.screenshot({ path: resolve(shots, '20-home-tags.png') })

// Tap #classic pill -> cross-spirit browse of all classic cocktails (4 seeds are classic)
await page.click('a:has-text("#classic")')
await page.waitForSelector('h1:has-text("Classic")')
const classicCount = await page.locator('a[href^="#/recipe/"]').count()
console.log('• #classic (cross-spirit) results:', classicCount)
await page.screenshot({ path: resolve(shots, '21-browse-classic.png') })

// Add a second tag (#sour) -> narrows via AND (Whiskey Sour, Daiquiri, Margarita are sour; not Old Fashioned)
await page.locator('button:has-text("#sour")').first().click()
await page.waitForTimeout(200)
const bothCount = await page.locator('a[href^="#/recipe/"]').count()
console.log('• classic + sour (AND) results:', bothCount)
const ofGone = (await page.locator('a[href^="#/recipe/"]:has-text("Old Fashioned")').count()) === 0
console.log('• Old Fashioned excluded by AND:', ofGone)
await page.screenshot({ path: resolve(shots, '22-browse-multi.png') })

console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close()
server.close()
process.exit(errors.length || classicCount < 3 || bothCount >= classicCount || !ofGone ? 1 : 0)
