// Rasterize the app icon SVG into the PNG sizes the PWA manifest needs,
// using the pre-installed Chromium via Playwright.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = resolve(root, 'public/icons')
mkdirSync(iconsDir, { recursive: true })

// glass mark centered; `pad` leaves a safe zone for maskable icons
function svg(size, pad) {
  const s = size
  const inset = size * pad
  const w = s - inset * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
    <rect width="${s}" height="${s}" fill="#17111d"/>
    <g transform="translate(${inset},${inset})">
      <g stroke="#e8a75c" stroke-width="${w * 0.05}" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <path d="M${w * 0.16} ${w * 0.28} L${w * 0.84} ${w * 0.28} L${w * 0.5} ${w * 0.6} Z"/>
        <path d="M${w * 0.5} ${w * 0.6} L${w * 0.5} ${w * 0.82}"/>
        <path d="M${w * 0.34} ${w * 0.82} L${w * 0.66} ${w * 0.82}"/>
      </g>
      <circle cx="${w * 0.63} " cy="${w * 0.4}" r="${w * 0.045}" fill="#f0b872"/>
    </g>
  </svg>`
}

const targets = [
  { file: 'icon-192.png', size: 192, pad: 0.12 },
  { file: 'icon-512.png', size: 512, pad: 0.12 },
  { file: 'icon-maskable-512.png', size: 512, pad: 0.22 },
  { file: 'apple-touch-icon.png', size: 180, pad: 0.12, out: 'public' },
]

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})
const page = await browser.newPage()
for (const t of targets) {
  const markup = svg(t.size, t.pad)
  await page.setViewportSize({ width: t.size, height: t.size })
  await page.setContent(
    `<style>*{margin:0;padding:0}</style>${markup}`,
    { waitUntil: 'networkidle' },
  )
  const el = await page.$('svg')
  const buf = await el.screenshot({ omitBackground: false })
  const outDir = t.out === 'public' ? resolve(root, 'public') : iconsDir
  writeFileSync(resolve(outDir, t.file), buf)
  console.log('wrote', t.file)
}
await browser.close()
