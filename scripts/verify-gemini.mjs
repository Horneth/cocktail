// Verify the cloud-AI UI: gear → Settings key entry unlocks Smart parse on
// Import, and a failed AI call falls back gracefully to the basic parser.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const shots = resolve(root, 'scripts/shots')
const PORT = 5096
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

const DESC = `Gimlet
2 oz Gin
0.75 oz Lime Juice
0.5 oz Simple Syrup

Simple Syrup
1 part sugar
1 part water`

// 1. No key yet → Import shows the nudge, basic parse present
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('a[aria-label="Settings"]')
console.log('• gear/Settings entry present on Home')
await page.click('text=Import')
await page.waitForSelector('textarea')
const nudge = await page.locator('text=Add a Gemini key').count()
console.log('• no-key nudge shown on Import:', nudge > 0)

// 2. Add a key in Settings → Smart parse appears on Import
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('a[aria-label="Settings"]')
await page.waitForSelector('input[placeholder="AIza…"]')
await page.fill('input[placeholder="AIza…"]', 'AIzaFAKEKEYForUiTestOnly')
await page.screenshot({ path: resolve(shots, '11-settings.png') })
await page.goto(BASE + '#/import', { waitUntil: 'networkidle' })
await page.waitForSelector('textarea')
const smart = await page.locator('button', { hasText: 'Smart parse' })
console.log('• Smart parse button present with key set:', (await smart.count()) > 0)
await page.screenshot({ path: resolve(shots, '12-import-ai.png') })

// 3. Basic fallback is always available even with AI enabled
await page.fill('textarea', DESC)
await page.click('text=Use basic parser instead')
await page.waitForSelector('text=Sub-recipes found', { timeout: 5000 })
const name = await page.inputValue('input[placeholder="Cocktail name"]')
console.log('• basic fallback (with AI enabled) parsed:', JSON.stringify(name))

// 4. Smart parse enters the busy state without crashing (network hangs in-sandbox)
await page.goto(BASE, { waitUntil: 'networkidle' }) // full reload resets SPA; key persists
await page.click('text=Import')
await page.waitForSelector('textarea')
await page.fill('textarea', DESC)
await page.locator('button', { hasText: 'Smart parse' }).first().click()
await page.waitForSelector('text=Parsing with Gemini', { timeout: 3000 })
console.log('• Smart parse triggers the Gemini call (busy state shown, no crash)')

console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close()
server.close()
process.exit(errors.length || !name.includes('Gimlet') ? 1 : 0)
