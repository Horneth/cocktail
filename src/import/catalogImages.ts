import { firebaseConfig } from '../config'
import { IMAGE_CATALOG } from '../domain/recipeImages'
import type { CocktailImage } from '../domain/recipeImages'
import bundledManifest from '../domain/recipeImagesManifest.json'

// The curated cocktail-image catalog, resolved at runtime.
//
// The bundled catalog (`recipeImages.json` + `recipeImagesManifest.json`) is what
// ships in the app and works offline. At boot we ALSO fetch a Storage-hosted copy
// (`cocktails/catalog.json` + `cocktails/manifest.json`) and merge it over the
// bundled set — so a new style can be added (generate + publish) without an app
// deploy. Storage wins on a slug collision; the merged set is cached for the
// session. When Storage is unreachable (offline, no bucket configured) the
// bundled set is used unchanged.
//
// `Recipe.image` for a suggested catalog shot is stored as the resolved URL
// (bundle or Storage), so backups stay self-contained and the SW runtime-caches
// the image bytes once seen.

type Manifest = Record<string, string>

function storageBase(): string | null {
  const bucket = firebaseConfig?.storageBucket
  return bucket
    ? `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/`
    : null
}

/** Bundle URL for a catalog file, e.g. /images/cocktails/sour-straw.png */
export function bundleImageUrl(file: string): string {
  return `${import.meta.env.BASE_URL}images/cocktails/${file}`
}

/** Storage URL for a catalog file, or null when no bucket is configured. */
export function storageImageUrl(file: string): string | null {
  const base = storageBase()
  if (!base) return null
  return `${base}${encodeURIComponent(`cocktails/${file}`)}?alt=media`
}

let mergedCatalog: Promise<CocktailImage[]> | null = null
let mergedManifest: Promise<Manifest> | null = null

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export function getMergedCatalog(): Promise<CocktailImage[]> {
  if (!mergedCatalog) {
    mergedCatalog = (async () => {
      const base = storageBase()
      const remote = base
        ? await fetchJson<CocktailImage[]>(`${base}${encodeURIComponent('cocktails/catalog.json')}?alt=media`)
        : null
      if (!remote) return IMAGE_CATALOG
      const bySlug = new Map(IMAGE_CATALOG.map((c) => [c.slug, c]))
      for (const c of remote) if (c?.slug) bySlug.set(c.slug, c)
      return [...bySlug.values()]
    })()
  }
  return mergedCatalog
}

export function getMergedManifest(): Promise<Manifest> {
  if (!mergedManifest) {
    mergedManifest = (async () => {
      const base = storageBase()
      const remote = base
        ? await fetchJson<Manifest>(`${base}${encodeURIComponent('cocktails/manifest.json')}?alt=media`)
        : null
      return { ...bundledManifest, ...(remote ?? {}) }
    })()
  }
  return mergedManifest
}

/** Resolve a catalog slug to its display URL (Storage when available, else the bundle). */
export async function catalogImageUrl(slug: string): Promise<string | null> {
  const manifest = await getMergedManifest()
  const file = manifest[slug]
  if (!file) return null
  return storageImageUrl(file) ?? bundleImageUrl(file)
}