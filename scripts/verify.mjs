import { chromium } from 'playwright'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const shots = resolve(root, 'scripts/shots')
const BASE = 'http://localhost:4173'

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

function log(...a) {
  console.log('•', ...a)
}

// 1. Home
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Daiquiri', { timeout: 8000 })
await page.screenshot({ path: resolve(shots, '1-home.png') })
log('home rendered; cocktails visible')

// 2. Search
await page.fill('input[placeholder*="Search"]', 'lime')
await page.waitForTimeout(200)
const limeCount = await page.locator('a[href^="/recipe/"]').count()
log('search "lime" ->', limeCount, 'results')
await page.fill('input[placeholder*="Search"]', '')

// 3. Detail + scaling
await page.click('text=Daiquiri')
await page.waitForSelector('text=Method')
await page.screenshot({ path: resolve(shots, '2-detail.png') })
const rumBefore = await page.locator('button', { hasText: '2' }).first().textContent()
// bump serving stepper
await page.click('button[aria-label="More"]')
await page.waitForTimeout(150)
const bodyText = await page.locator('section').first().innerText()
log('after ×2, ingredient section:', JSON.stringify(bodyText.split('\n').slice(0, 6)))
await page.screenshot({ path: resolve(shots, '3-detail-scaled.png') })

// reset to 1x by clicking Fewer
await page.click('button[aria-label="Fewer"]')
await page.waitForTimeout(100)

// 4. Per-ingredient tweak
const amountBtns = page.locator('section').first().locator('button')
await amountBtns.first().click()
await page.waitForTimeout(150)
const tweakerVisible = await page.locator('[aria-label="More"]').count()
log('inline tweaker opened, controls:', tweakerVisible)

// 5. Sub-recipe cross-link
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('text=Daiquiri')
await page.waitForSelector('a[href*="/recipe/"] >> text=Simple Syrup')
await page.click('text=Simple Syrup')
await page.waitForSelector('text=Used in')
const usedIn = await page.locator('text=Used in').locator('xpath=following-sibling::*').first().innerText()
log('Simple Syrup "Used in":', JSON.stringify(usedIn))
await page.screenshot({ path: resolve(shots, '4-subrecipe.png') })

// 6. New recipe screen loads
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.click('a[href="/new"]')
await page.waitForSelector('input[placeholder*="name"]')
await page.screenshot({ path: resolve(shots, '5-new.png') })
log('new recipe screen renders')

// 7. Offline reload — service worker should serve the app
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(1500) // let SW activate
await ctx.setOffline(true)
await page.reload({ waitUntil: 'domcontentloaded' }).catch((e) => log('reload err', e.message))
const offlineOk = await page.locator('text=Cocktails').count()
log('offline reload -> Cocktails heading present:', offlineOk > 0)
await ctx.setOffline(false)

console.log('\nConsole/page errors:', errors.length ? errors : 'none')
await browser.close()
if (errors.length) process.exit(1)
