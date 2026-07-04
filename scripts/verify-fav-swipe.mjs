// Verify favorites (toggle + pin + filter) and swipe-to-delete on Home.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const shots = resolve(root, 'scripts/shots')
const PORT = 5094
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

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Whiskey Sour')

// 1. Favorite the Whiskey Sour via its heart, expect it to pin to the top
const wsCard = page.locator('li', { hasText: 'Whiskey Sour' })
await wsCard.locator('button[aria-label="Favorite"]').click()
await page.waitForTimeout(300)
const firstCardName = await page.locator('ul li').first().innerText()
console.log('• after favoriting, top card is Whiskey Sour:', /Whiskey Sour/.test(firstCardName))

// 2. Favorites filter chip shows and filters
await page.click('button:has-text("Favorites")')
await page.waitForTimeout(200)
const countFav = await page.locator('ul li').count()
console.log('• Favorites filter shows only favorited:', countFav === 1)
await page.screenshot({ path: resolve(shots, '15-favorites.png') })
await page.click('button:has-text("Favorites")') // clear

// 3. Swipe-to-delete: drag the Margarita card left, tap Delete
const before = await page.locator('ul li').count()
const marg = page.locator('li', { hasText: 'Margarita' })
const box = await marg.locator('div').first().boundingBox()
const y = box.y + box.height / 2
await page.mouse.move(box.x + box.width - 30, y)
await page.mouse.down()
await page.mouse.move(box.x + box.width - 120, y, { steps: 8 })
await page.mouse.move(box.x + 30, y, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(300)
await page.screenshot({ path: resolve(shots, '16-swipe.png') })
const delBtn = marg.locator('button[aria-label="Delete"]')
const delVisible = await delBtn.isVisible()
console.log('• swipe revealed Delete button:', delVisible)
await delBtn.click({ force: true })
await page.waitForTimeout(400)
const after = await page.locator('ul li').count()
const margGone = (await page.locator('li', { hasText: 'Margarita' }).count()) === 0
console.log('• delete removed the card:', margGone, `(${before} -> ${after})`)

console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close()
server.close()
process.exit(errors.length || !margGone || !delVisible ? 1 : 0)
