// Verify custom spirits: import a Caipirinha, correct the base spirit to
// "cachaça" in the preview, import it, and confirm it becomes its own mosaic
// tile on the home screen.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const shots = resolve(root, 'scripts/shots')
const PORT = 5089
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.addInitScript(() => localStorage.setItem('cocktail.geminiKey', 'TEST-KEY'))
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

// Gemini (mocked) mis-books it as rum
await page.route(/generativelanguage/, (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      name: 'Caipirinha',
      kind: 'cocktail',
      spirit: 'rum',
      tags: ['refreshing', 'sour'],
      ingredients: [
        { amount: 2, unit: 'oz', name: 'Cachaça' },
        { amount: 0.5, unit: 'each', name: 'Lime, quartered' },
        { amount: 2, unit: 'tsp', name: 'Sugar' },
      ],
    }) }] } }] }),
  }),
)

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('text=Import')
await page.waitForSelector('textarea')
await page.fill('textarea', 'caipirinha recipe with cachaça...')
await page.locator('button', { hasText: 'Smart parse' }).first().click()
await page.waitForSelector('input[list="import-spirits"]', { timeout: 8000 })

const detected = await page.inputValue('input[list="import-spirits"]')
console.log('• editable base-spirit field prefilled with:', JSON.stringify(detected))

// correct it to cachaça
await page.fill('input[list="import-spirits"]', 'cachaça')
await page.screenshot({ path: resolve(shots, '23-import-cachaca.png') })
await page.click('text=Import recipe')
await page.waitForSelector('h1:has-text("Caipirinha")', { timeout: 5000 })

// home mosaic should now have a Cachaça tile
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=All cocktails')
const cachacaTile = await page.locator('a[href*="scope=cacha"]').count()
console.log('• Cachaça tile on home mosaic:', cachacaTile > 0)
await page.screenshot({ path: resolve(shots, '24-mosaic-cachaca.png') })

console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close()
server.close()
process.exit(errors.length || cachacaTile < 1 ? 1 : 0)
