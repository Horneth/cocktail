import { db } from '../db/db'
import { migrateLegacyRecipe } from '../domain/recipeKind'
import type { Bar, PantryItem, Recipe, RecipeLink } from '../db/schema'

// Whole-library export/import.
//
// Everything this app knows lives in the browser: IndexedDB for recipes and
// bars, localStorage for preferences. That is the point (no accounts, no
// server) — but it also means the library is bound to one *origin*. Moving the
// app from github.io to its own domain leaves every saved recipe behind,
// because a different origin gets a different, empty IndexedDB. This module is
// the way across: dump to a file on the old origin, load it on the new one.
//
// It lives in the import seam for the same reason importRecipe() does — bulk
// writes go through one place, in one transaction, so a half-applied restore
// can't happen.

/** Bumped only if the file layout changes in a way an old reader can't handle. */
export const BACKUP_VERSION = 1

/**
 * Preferences worth carrying across a device (or origin) move.
 *
 * The list is an allowlist rather than "everything under cocktail.*" precisely
 * so that credentials and session state can never leak into a file that gets
 * emailed to yourself and dropped in cloud storage. That kept the old
 * bring-your-own Gemini key out of backups; it now keeps `cocktail.signedIn`
 * out too, which is device-local by nature — restoring it elsewhere would only
 * make that browser load the Firebase SDK for a session it doesn't have.
 */
const PORTABLE_SETTINGS = [
  'cocktail.volumePref',
  'cocktail.assumeStaples',
  'cocktail.activeBarId',
] as const

export interface BackupFile {
  app: 'cocktail'
  version: number
  exportedAt: number
  data: {
    recipes: Recipe[]
    recipeLinks: RecipeLink[]
    bars: Bar[]
    bottles: PantryItem[]
  }
  settings: Record<string, string>
}

/** Read the whole library out of IndexedDB + localStorage. */
export async function exportBackup(): Promise<BackupFile> {
  const [recipes, recipeLinks, bars, bottles] = await Promise.all([
    db.recipes.toArray(),
    db.recipeLinks.toArray(),
    db.bars.toArray(),
    db.bottles.toArray(),
  ])

  const settings: Record<string, string> = {}
  for (const key of PORTABLE_SETTINGS) {
    const value = localStorage.getItem(key)
    if (value !== null) settings[key] = value
  }

  return {
    app: 'cocktail',
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    data: { recipes, recipeLinks, bars, bottles },
    settings,
  }
}

/**
 * Parse and validate untrusted JSON as a backup file.
 *
 * Throws rather than returning a partial result: the caller is about to erase
 * the user's library, so a malformed file has to stop the whole operation
 * before the transaction opens.
 */
export function parseBackup(json: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }

  if (typeof raw !== 'object' || raw === null) throw new Error('That file is not a backup.')
  const obj = raw as Record<string, unknown>
  if (obj.app !== 'cocktail') throw new Error('That file is not a Cocktails backup.')
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) {
    throw new Error('That backup was made by a newer version of the app.')
  }

  const data = obj.data as Record<string, unknown> | undefined
  if (typeof data !== 'object' || data === null) throw new Error('That backup has no data in it.')

  const table = (name: string): unknown[] => {
    const rows = data[name]
    // A backup predating a store (or one hand-edited to drop it) restores as
    // empty rather than failing — every store is independently rebuildable.
    if (rows === undefined) return []
    if (!Array.isArray(rows)) throw new Error(`That backup's "${name}" section is damaged.`)
    return rows
  }

  return {
    app: 'cocktail',
    version: obj.version,
    exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
    data: {
      recipes: table('recipes') as Recipe[],
      recipeLinks: table('recipeLinks') as RecipeLink[],
      bars: table('bars') as Bar[],
      bottles: table('bottles') as PantryItem[],
    },
    settings:
      typeof obj.settings === 'object' && obj.settings !== null
        ? (obj.settings as Record<string, string>)
        : {},
  }
}

/**
 * Replace the entire library with the contents of a backup.
 *
 * Replace, not merge: the use case is "move my library to this device", where
 * merging would need id-collision rules nobody asked for and would silently
 * resurrect recipes the user deleted. One Dexie transaction across all four
 * stores, so an interrupted restore rolls back to the previous library instead
 * of leaving a half-imported one.
 */
export async function importBackup(backup: BackupFile): Promise<void> {
  const { recipes, recipeLinks, bars, bottles } = backup.data

  await db.transaction('rw', db.recipes, db.recipeLinks, db.bars, db.bottles, async () => {
    await Promise.all([
      db.recipes.clear(),
      db.recipeLinks.clear(),
      db.bars.clear(),
      db.bottles.clear(),
    ])
    await Promise.all([
      db.recipes.bulkPut(recipes.map((r) => migrateLegacyRecipe(r))),
      db.recipeLinks.bulkPut(recipeLinks),
      db.bars.bulkPut(bars),
      db.bottles.bulkPut(bottles),
    ])
  })

  // Settings only after the data lands — activeBarId pointing at a bar that
  // doesn't exist yet would leave the Bar screen briefly empty. Unknown keys in
  // the file are ignored; only the ones we know how to honour are restored.
  for (const key of PORTABLE_SETTINGS) {
    const value = backup.settings[key]
    if (typeof value === 'string') localStorage.setItem(key, value)
  }
}

/** Filename for a downloaded backup: cocktails-backup-2026-08-09.json */
export function backupFilename(at: number = Date.now()): string {
  const iso = new Date(at).toISOString().slice(0, 10)
  return `cocktails-backup-${iso}.json`
}
