import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { poolKeyForName } from './poolKey.mjs'

// The pool rules exist twice on disk: the canonical copy in src/domain (what
// the app and the seeder run) and a verbatim copy in functions/shared (what
// deploys with the Cloud Function — the deploy packs functions/ only). The
// key a recipe stores and the key the function writes must never disagree, so
// this test fails the build the moment one copy is edited without the other.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const COPIES = ['poolKey.mjs', 'poolPrompt.mjs']

describe('functions/shared mirrors src/domain', () => {
  for (const file of COPIES) {
    it(`${file} is byte-identical on both sides`, () => {
      const canonical = readFileSync(resolve(root, `src/domain/${file}`), 'utf8')
      const copy = readFileSync(resolve(root, `functions/shared/${file}`), 'utf8')
      expect(copy).toBe(canonical)
    })
  }

  it('the canonical module still produces the pinned keys', () => {
    // If either side drifts semantically, existing pool lookups 404 into the
    // tile fallback — so pin a few canonical examples right here too.
    expect(poolKeyForName('Daiquiri')).toBe('daiquiri')
    expect(poolKeyForName('Paper Plane')).toBe('paper-plane')
    expect(poolKeyForName('Café Royale')).toBe('cafe-royale')
  })
})
