// Verify the three improvements: tag filter on Home, clean parsed names
// (no "(30 ml)"), and ingredient autocomplete in the editor.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const shots = resolve(root, 'scripts/shots')
const PORT = 5097
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

// 1. Tag filter on Home
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Daiquiri')
const classicChip = page.locator('button', { hasText: /^#classic$/ })
await classicChip.first().click()
await page.waitForTimeout(200)
const afterTag = await page.locator('a[href^="#/recipe/"], a[href^="/recipe/"]').count()
console.log('• #classic tag filter -> results:', afterTag)
await page.screenshot({ path: resolve(shots, '8-tag-filter.png') })
await classicChip.first().click() // toggle off

// 2. Parser strips "(30 ml)" — import a dual-unit description
await page.click('text=Import')
await page.waitForSelector('textarea')
await page.fill('textarea', `Gimlet
2 oz. (60 ml) Gin
0.75 oz. (22 ml) Lime Juice
0.5 oz (15 ml) Simple Syrup

Simple Syrup
1 part sugar
1 part water`)
await page.click('text=Parse recipe')
await page.waitForSelector('text=Sub-recipes found')
const ingNames = await page.locator('input.' + (await firstIngClass(page))).count().catch(() => 0)
const values = await page.$$eval('input[placeholder="Ingredient"]', (els) => els.map((e) => e.value))
console.log('• parsed ingredient names:', JSON.stringify(values))
const clean = values.every((v) => !/\(\s*\d+\s*(ml|oz)/i.test(v))
console.log('• names free of "(NN ml)" conversions:', clean)
await page.screenshot({ path: resolve(shots, '9-import-clean.png') })

// 3. Ingredient autocomplete in the editor: type "Lem" and expect a suggestion
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('a[href="#/new"], a[href="/new"]')
await page.waitForSelector('input[placeholder="Ingredient name"]')
await page.fill('input[placeholder="Ingredient name"]', 'Lem')
await page.waitForTimeout(250)
const suggestionTexts = await page.$$eval('button', (els) => els.map((e) => e.textContent?.trim()).filter(Boolean))
const hasLemon = suggestionTexts.some((t) => /lemon|lime/i.test(t))
console.log('• editor autocomplete offered a known ingredient:', hasLemon)
await page.screenshot({ path: resolve(shots, '10-autocomplete.png') })

console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close()
server.close()
process.exit(errors.length || !clean || !hasLemon ? 1 : 0)

async function firstIngClass() { return 'ingName' }
