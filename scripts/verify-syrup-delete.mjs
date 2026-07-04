// Verify swipe-to-delete works on syrups (components), that the in-use confirm
// fires, and that deleting a shared syrup unlinks it from cocktails gracefully.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const PORT = 5093
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
let confirmed = false
page.on('dialog', (d) => { confirmed = true; d.accept() }) // accept the in-use confirm

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('text=Syrups & more')
await page.waitForSelector('text=Simple Syrup')

// swipe the Simple Syrup card left and delete
const card = page.locator('li', { hasText: 'Simple Syrup' })
const box = await card.locator('div').first().boundingBox()
const y = box.y + box.height / 2
await page.mouse.move(box.x + box.width * 0.7, y)
await page.mouse.down()
await page.waitForTimeout(60)
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(box.x + box.width * 0.7 - i * 22, y)
  await page.waitForTimeout(10)
}
await page.mouse.up()
await page.waitForTimeout(300)
await page.screenshot({ path: resolve(root, 'scripts/shots/17-syrup-swipe.png') })
const delBtn = card.locator('button[aria-label="Delete"]')
await delBtn.waitFor({ state: 'visible' })
await delBtn.click()
await page.waitForTimeout(400)

const gone = (await page.locator('li', { hasText: 'Simple Syrup' }).count()) === 0
console.log('• in-use confirm fired:', confirmed)
console.log('• syrup deleted from list:', gone)

// a cocktail that used it keeps the ingredient, now as plain text (no link)
await page.getByRole('button', { name: 'Cocktails' }).click()
await page.click('text=Daiquiri')
await page.waitForSelector('text=Method')
const ingText = await page.locator('section').first().innerText()
const hasSyrupText = /Simple Syrup/.test(ingText)
const syrupIsLink = (await page.locator('a', { hasText: 'Simple Syrup' }).count()) > 0
console.log('• cocktail keeps "Simple Syrup" ingredient:', hasSyrupText, '| still a link:', syrupIsLink)

console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close()
server.close()
process.exit(errors.length || !gone || !confirmed || !hasSyrupText || syrupIsLink ? 1 : 0)
