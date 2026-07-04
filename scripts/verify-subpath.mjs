// Self-contained check: serve dist under /cocktail/ from an in-process HTTP
// server and drive it with Chromium — no detached process to be reaped.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const PORT = 5099
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
}

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0])
    path = path.replace(/^\/cocktail\//, '/') // strip base
    if (path === '/' || path === '') path = '/index.html'
    let file = resolve(dist, '.' + path)
    let body
    try {
      body = await readFile(file)
    } catch {
      body = await readFile(resolve(dist, 'index.html')) // SPA-ish fallback
      file = 'index.html'
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(body)
  } catch (e) {
    res.writeHead(500)
    res.end(String(e))
  }
})

await new Promise((r) => server.listen(PORT, r))
const BASE = `http://localhost:${PORT}/cocktail/`

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('text=Daiquiri', { timeout: 8000 })
console.log('• home renders at /cocktail/')

await page.click('text=Daiquiri')
await page.waitForSelector('text=Method', { timeout: 5000 })
const url = page.url()
console.log('• navigated to detail; url =', url)
console.log('• hash route:', url.includes('#/recipe/') ? 'OK' : 'UNEXPECTED')

await page.click('text=Simple Syrup')
await page.waitForSelector('text=Used in', { timeout: 5000 })
console.log('• sub-recipe cross-link works under subpath')

console.log('\nerrors:', errors.length ? errors : 'none')
await browser.close()
server.close()
process.exit(errors.length ? 1 : 0)
