// Verify (1) multi-cocktail smart parse shows a pick-list and imports the
// selected drinks, deduping a shared syrup, and (2) the Android share-target
// deep link (?title&text&url) drops into Import and auto-parses.
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

// Two cocktails that SHARE one syrup (Rich Simple Syrup) — should dedupe to one component.
const TWO_DRINKS = {
  recipes: [
    {
      name: 'Daiquiri', kind: 'cocktail', spirit: 'rum', tags: ['sour', 'refreshing'],
      ingredients: [
        { amount: 2, unit: 'oz', name: 'White Rum' },
        { amount: 1, unit: 'oz', name: 'Lime Juice' },
        { amount: 0.75, unit: 'oz', name: 'Rich Simple Syrup' },
      ],
      subRecipes: [{ name: 'Rich Simple Syrup', ingredients: [{ amount: 2, unit: 'parts', name: 'sugar' }, { amount: 1, unit: 'part', name: 'water' }] }],
    },
    {
      name: 'Whiskey Sour', kind: 'cocktail', spirit: 'bourbon', tags: ['sour', 'classic'],
      ingredients: [
        { amount: 2, unit: 'oz', name: 'Bourbon' },
        { amount: 0.75, unit: 'oz', name: 'Lemon Juice' },
        { amount: 0.75, unit: 'oz', name: 'Rich Simple Syrup' },
      ],
      subRecipes: [{ name: 'Rich Simple Syrup', ingredients: [{ amount: 2, unit: 'parts', name: 'sugar' }, { amount: 1, unit: 'part', name: 'water' }] }],
    },
  ],
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
await ctx.addInitScript(() => localStorage.setItem('cocktail.geminiKey', 'TEST-KEY'))
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.route(/generativelanguage/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(TWO_DRINKS) }] } }] }) }),
)

// --- 1. Multi-cocktail smart parse + pick-list ---
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('text=Import')
await page.waitForSelector('textarea')
await page.fill('textarea', 'video description with a daiquiri and a whiskey sour...')
await page.locator('button', { hasText: 'Smart parse' }).first().click()
await page.waitForSelector('text=2 cocktails found', { timeout: 8000 })
await page.waitForSelector('text=Daiquiri')
await page.waitForSelector('text=Whiskey Sour')
await page.screenshot({ path: resolve(shots, '25-multi-picklist.png') })

// deselect one, confirm the import button reflects the count
await page.locator('button', { hasText: 'Whiskey Sour' }).click()
const btn1 = await page.locator('button', { hasText: 'Import recipe' }).count()
console.log('• deselecting one leaves a single "Import recipe" button:', btn1 > 0)
// re-select and import both
await page.locator('button', { hasText: 'Whiskey Sour' }).click()
await page.locator('button', { hasText: 'Import 2 recipes' }).click()

// lands on home; both cocktails present
await page.waitForSelector('text=All cocktails', { timeout: 5000 })
await page.goto(`${BASE}#/browse?scope=all`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
const daiq = await page.locator('text=Daiquiri').count()
const wsour = await page.locator('text=Whiskey Sour').count()
console.log('• Daiquiri imported:', daiq > 0)
console.log('• Whiskey Sour imported:', wsour > 0)

// shared syrup deduped to ONE component
await page.goto(`${BASE}#/browse?scope=components`, { waitUntil: 'networkidle' })
await page.waitForTimeout(300)
const syrupCount = await page.locator('text=Rich Simple Syrup').count()
console.log('• Rich Simple Syrup component count (expect 1):', syrupCount)
await page.screenshot({ path: resolve(shots, '26-components.png') })

// --- 2. Share-target deep link auto-parses ---
const SINGLE = { recipes: [{ name: 'Margarita', kind: 'cocktail', spirit: 'tequila', tags: ['sour'], ingredients: [{ amount: 2, unit: 'oz', name: 'Tequila' }, { amount: 1, unit: 'oz', name: 'Lime Juice' }, { amount: 0.75, unit: 'oz', name: 'Cointreau' }] }] }
await page.unroute(/generativelanguage/)
await page.route(/generativelanguage/, (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(SINGLE) }] } }] }) }),
)
const shareUrl = `${BASE}?title=${encodeURIComponent('Margarita recipe')}&text=${encodeURIComponent('2 oz tequila, 1 oz lime, 0.75 oz cointreau')}&url=${encodeURIComponent('https://youtu.be/abcdefghijk')}`
await page.goto(shareUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('input[list="import-spirits"]', { timeout: 8000 })
const routedToImport = page.url().includes('#/import')
const spiritVal = await page.inputValue('input[list="import-spirits"]')
console.log('• share link routed into #/import:', routedToImport)
console.log('• share auto-parsed a recipe, spirit field =', JSON.stringify(spiritVal))
await page.screenshot({ path: resolve(shots, '27-share-autoparse.png') })

const ok = daiq > 0 && wsour > 0 && syrupCount === 1 && routedToImport && spiritVal.length > 0 && btn1 > 0
console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close()
server.close()
process.exit(errors.length || !ok ? 1 : 0)
