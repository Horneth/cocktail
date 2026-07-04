# 🍸 Cocktail

A fast, offline, install-to-your-phone cocktail recipe book. Open it, pick a
drink, and build it in seconds. Tweak measurements on the fly, keep personal
notes, and cross-link sub-recipes (syrups, cordials) shared across many drinks.

Built as a **PWA** — a web app you can "Add to Home Screen" that works fully
offline with all data stored locally on your device. No accounts, no server.

## Highlights

- **Instant, offline** — recipes live in IndexedDB and the app shell is cached
  by a service worker, so cold-open to recipe is sub-second and works with no
  network.
- **Build-it-now detail view** — a big serving stepper rescales the whole drink
  instantly; tap any single amount to nudge it. Amounts render as bar fractions
  (¾ oz) with an oz ⇄ ml toggle.
- **Non-destructive tweaks** — scaling and per-ingredient nudges never touch the
  stored recipe unless you tap *Save to recipe*.
- **Cross-linked sub-recipes** — a syrup is a first-class recipe. Tap through
  from a cocktail to its Simple Syrup and back; each component shows a
  *Used in* list of every drink that references it.
- **Parts & volumes** — recipes can be absolute (2 oz, ¾ oz) or ratio-based
  (1 part : 1 part), with a per-part volume selector.

## Stack

React + Vite + TypeScript · Dexie (IndexedDB) with `useLiveQuery` as the only
state layer · react-router · vite-plugin-pwa · CSS Modules. Deliberately few
dependencies.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173  (service worker enabled in dev)
npm run build      # production build + service worker
npm run preview    # serve the production build (test install/offline here)
npm test           # vitest — units, scaling, import/link dedup
npm run typecheck
```

Regenerate PWA icons from the SVG source: `node scripts/make-icons.mjs`.

## Data model (one entity, cross-linked)

A cocktail and a syrup are the **same** `Recipe`, distinguished by
`kind: 'cocktail' | 'component'`. Ingredients carry an optional `subRecipeId`
that points at a component; a denormalized `recipeLinks` table indexes that
relationship both ways (for fast *Used in* back-links and shared components).
See `src/db/schema.ts`.

## Import from a video (phase 2 — shipped)

Tap **Import** on the home screen, paste a video's **description** (tuned for
the Anders Erickson channel), and an on-device parser
(`src/import/parseRecipeText.ts`) turns it into the cocktail plus any
syrups/cordials — **cross-linked** automatically by name. An editable preview
lets you fix anything before saving. It runs entirely client-side: no backend,
no API keys, works offline. Everything funnels through the same
`importRecipe(StructuredImport)` seam the seed data uses.

The parser is forgiving (handles `oz`, parts, dashes, `¾`/`3/4`/`.75`, no-amount
toppers like "Club Soda", garnish/method lines) and strips description noise
(chapters, gear links, socials). `Recipe.source` records provenance (and the
YouTube URL/video id when present in the pasted text).

### Roadmap: one-tap URL import (phase 2b)

Paste just a URL and have it auto-fetch + AI-parse. A browser can't fetch a
YouTube description directly (CORS), so this needs a small backend (e.g. a
Cloudflare Worker) plus an Anthropic API key. It reuses the same
`StructuredImport` contract — only the text-acquisition + parse step changes.
