// End-to-end check of the paste-to-import flow, self-contained (in-process
// static server + Chromium) so nothing gets reaped.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const shots = resolve(root, 'scripts/shots')
const PORT = 5098
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png',
}
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(req.url.split('?')[0]).replace(/^\/cocktail\//, '/')
  if (path === '/' || path === '') path = '/index.html'
  let file = resolve(dist, '.' + path)
  let body
  try { body = await readFile(file) } catch { body = await readFile(resolve(dist, 'index.html')); file = 'index.html' }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
  res.end(body)
})
await new Promise((r) => server.listen(PORT, r))
const BASE = `http://localhost:${PORT}/cocktail/`

const DESCRIPTION = `The Tom Collins is a refreshing classic. Here's how I make mine.

Tom Collins
2 oz Gin
1 oz Lemon Juice
1/2 oz Semi-Rich Simple Syrup (1.5:1)
Club Soda
Garnish: Lemon wheel and cherry

Shake the first three ingredients with ice, strain into a Collins glass over fresh ice, top with club soda.

Semi-Rich Simple Syrup
1.5 parts sugar
1 part water

CHAPTERS:
0:00 Intro
GEAR I USE:
Shaker: https://amazon.com/xyz
Follow me on Instagram: @anderserickson`

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('text=Import')
await page.waitForSelector('textarea')
console.log('• import screen opened')

await page.fill('textarea', DESCRIPTION)
await page.click('text=Parse recipe')
await page.waitForSelector('text=Sub-recipes found', { timeout: 5000 })
const nameVal = await page.inputValue('input[placeholder="Cocktail name"]')
console.log('• parsed name =', JSON.stringify(nameVal))
await page.screenshot({ path: resolve(shots, '6-import-preview.png') })

await page.click('text=Import recipe')
await page.waitForSelector('text=Method', { timeout: 5000 })
const title = await page.locator('h1').first().innerText()
console.log('• imported; detail title =', JSON.stringify(title))
await page.screenshot({ path: resolve(shots, '7-import-detail.png') })

// verify cross-link: tap the syrup, expect Tom Collins in "Used in"
await page.click('text=Semi-Rich Simple Syrup')
await page.waitForSelector('text=Used in', { timeout: 5000 })
const usedIn = await page.locator('text=Used in').locator('xpath=following-sibling::*').first().innerText()
console.log('• syrup "Used in" =', JSON.stringify(usedIn))

console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close()
server.close()
process.exit(errors.length || !nameVal.includes('Tom Collins') || !usedIn.includes('Tom Collins') ? 1 : 0)
