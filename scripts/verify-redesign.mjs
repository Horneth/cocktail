// Throwaway smoke check for the Nightcap redesign. Drives the preview build and
// screenshots each primary screen + a recipe detail. Not part of `npm test`.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const BASE = 'http://localhost:4173/'
const OUT = 'scripts/shots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: EXEC })
const page = await browser.newPage({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

async function shot(name) {
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log('shot', name)
}

async function go(hash) {
  await page.goto(BASE + hash, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
}

await go('#/')
await shot('01-home')

// open add sheet via center FAB
await page.locator('button[aria-label="Add"]').click()
await shot('02-add-sheet')
await page.keyboard.press('Escape').catch(() => {})
await page.mouse.click(215, 120) // tap backdrop area
await page.waitForTimeout(400)

await go('#/search')
await shot('03-search')

await go('#/browse')
await shot('04-browse')

// open first recipe
const firstRow = page.locator('a[href^="#/recipe/"]').first()
if (await firstRow.count()) {
  await firstRow.click()
  await shot('05-recipe')
  await page.goBack()
}

await go('#/bar')
await shot('06-bar')

await go('#/import')
await shot('07-import')

await go('#/new')
await shot('08-build')

console.log('\nConsole errors:', errors.length ? errors : 'none')
await browser.close()
