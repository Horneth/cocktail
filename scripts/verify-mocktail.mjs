// Mock Gemini returning a zero-proof drink; confirm the import preview shows a
// "mocktail" spirit chip (i.e. it isn't treated as 'none' and hidden).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const PORT = 5092
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

await page.route(/generativelanguage/, (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        name: 'Virgin Mojito',
        kind: 'cocktail',
        spirit: 'virgin', // synonym -> mocktail
        tags: ['refreshing', 'mocktail'],
        ingredients: [
          { amount: 2, unit: 'oz', name: 'Non-Alcoholic Rum' },
          { amount: 1, unit: 'oz', name: 'Lime Juice' },
          { amount: null, unit: 'top', name: 'Soda Water' },
        ],
      }) }] } }],
    }),
  }),
)

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('text=Import')
await page.waitForSelector('textarea')
await page.fill('textarea', 'a virgin mojito recipe...')
await page.locator('button', { hasText: 'Smart parse' }).first().click()
await page.waitForSelector('text=Import recipe', { timeout: 8000 })
await page.waitForTimeout(200)
const mocktailChip = await page.locator('text=mocktail').first().isVisible().catch(() => false)
console.log('• mocktail spirit chip shown in preview:', mocktailChip)

console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close()
server.close()
process.exit(errors.length || !mocktailChip ? 1 : 0)
