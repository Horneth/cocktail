// Regression: after a COLD-START Android share (app was not open), both the
// in-app Back arrow and the Android system back must return to Home — not a
// dead end. The router must boot at Home with /import pushed on top.
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
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
await ctx.addInitScript(() => localStorage.setItem('cocktail.geminiKey', 'TEST-KEY'))
const page = await ctx.newPage()
const payload = { recipes: [{ name: 'Margarita', kind: 'cocktail', spirit: 'tequila', tags: ['sour'], ingredients: [{ amount: 2, unit: 'oz', name: 'Tequila' }] }] }
const geminiBody = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] })
await page.route(/generativelanguage/, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: geminiBody }))
const shareUrl = `${BASE}?title=${encodeURIComponent('Margarita')}&text=${encodeURIComponent('2 oz tequila')}&url=${encodeURIComponent('https://youtu.be/abcdefghijk')}`

// in-app Back arrow
await page.goto(shareUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('input[list="import-spirits"]', { timeout: 8000 })
const routed = page.url().includes('#/import')
await page.click('button[aria-label="Back"]')
await page.waitForTimeout(400)
const backHome = (await page.locator('text=Cocktails').count()) > 0 && page.url().endsWith('/cocktail/')
console.log('• share boots to import:', routed)
console.log('• in-app Back → Home:', backHome)

// Android system back
await page.goto(shareUrl, { waitUntil: 'networkidle' })
await page.waitForSelector('input[list="import-spirits"]', { timeout: 8000 })
await page.evaluate(() => history.back())
await page.waitForTimeout(500)
const sysBackHome = (await page.locator('text=Cocktails').count()) > 0
console.log('• system Back → Home:', sysBackHome)

await browser.close(); server.close()
process.exit(routed && backHome && sysBackHome ? 0 : 1)
