// Verify the smarter Gemini path by MOCKING the Gemini endpoint, so we can
// deterministically confirm spirit + tags + cocktail/component classification
// render in the import preview (no network / key needed).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const shots = resolve(root, 'scripts/shots')
const PORT = 5095
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

function geminiReply(recipe) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(recipe) }] } }] }) }
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
// preset the API key so Smart parse is enabled
await ctx.addInitScript(() => localStorage.setItem('cocktail.geminiKey', 'TEST-KEY'))
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

// --- 1. A cocktail: expect spirit + tags + linked sub-recipe ---
await page.route(/generativelanguage/, (route) =>
  route.fulfill(
    geminiReply({
      name: 'Daiquiri',
      kind: 'cocktail',
      spirit: 'rum',
      method: 'Shake',
      garnish: 'Lime wheel',
      tags: ['sour', 'classic', 'citrusy'],
      ingredients: [
        { amount: 2, unit: 'oz', name: 'White rum' },
        { amount: 0.75, unit: 'oz', name: 'Lime juice' },
        { amount: 0.75, unit: 'oz', name: 'Simple Syrup' },
      ],
      subRecipes: [{ name: 'Simple Syrup', ingredients: [ { amount: 1, unit: 'part', name: 'sugar' }, { amount: 1, unit: 'part', name: 'water' } ] }],
    }),
  ),
)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('text=Import')
await page.waitForSelector('textarea')
await page.fill('textarea', 'paste of a daiquiri video description...')
await page.locator('button', { hasText: 'Smart parse' }).first().click()
await page.waitForSelector('text=Sub-recipes found', { timeout: 8000 })
const spirit = await page.locator('text=rum').first().isVisible()
const hasSour = await page.locator('text=#sour').count()
const hasClassic = await page.locator('text=#classic').count()
console.log('• cocktail: spirit chip shown:', spirit, '| tags #sour,#classic:', hasSour > 0 && hasClassic > 0)
await page.screenshot({ path: resolve(shots, '13-smart-cocktail.png') })

// --- 2. A standalone syrup: expect component classification ---
await page.unroute(/generativelanguage/)
await page.route(/generativelanguage/, (route) =>
  route.fulfill(
    geminiReply({
      name: 'Orgeat',
      kind: 'component',
      ingredients: [ { amount: 2, unit: 'parts', name: 'almond milk' }, { amount: 1, unit: 'part', name: 'sugar' } ],
    }),
  ),
)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('text=Import')
await page.waitForSelector('textarea')
await page.fill('textarea', 'how to make orgeat syrup...')
await page.locator('button', { hasText: 'Smart parse' }).first().click()
await page.waitForSelector('text=Detected as a sub-recipe', { timeout: 8000 })
const subLabel = await page.locator('text=Sub-recipe name').count()
console.log('• syrup-only classified as component:', subLabel > 0)
await page.screenshot({ path: resolve(shots, '14-smart-syrup.png') })

console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close()
server.close()
process.exit(errors.length || !spirit || !(hasSour > 0) || !(subLabel > 0) ? 1 : 0)
