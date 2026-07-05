# 🍸 Cocktail

A fast, offline, install-to-your-phone cocktail recipe book. Open it, pick a
drink, and build it in seconds. Tweak measurements on the fly, keep personal
notes, and cross-link sub-recipes (syrups, cordials) shared across many drinks.

Built as a **PWA** — a web app you can "Add to Home Screen" that works fully
offline with all data stored locally on your device. No accounts, no server.

## Highlights

- **Browse by spirit or tag** — the home screen is a mosaic of base-spirit
  tiles (gin, rum, whiskey, tequila, mocktails, …) plus a "Browse by tag"
  section. Everything funnels into one `/browse` view driven by the URL
  (`scope` + `tags`): a spirit tile scopes to that spirit, a tag pill filters
  across *all* spirits, and the wrapping tag picker is **multi-select** (AND) —
  e.g. all *refreshing + citrusy* drinks. A search bar is always available;
  "All", "Favorites", and "Syrups & more" get their own tiles. **Spirits are
  free-form** — type any base spirit (cachaça, pisco, sake…) in the editor or
  import preview and it gets its own tile with generated art; the import keeps
  the specific spirit a recipe names rather than collapsing it.
- **My Bar & "what can I make"** — tell the app which bottles you actually have
  (a tap-to-toggle inventory at `/bar`), then flip **Only what I can make** on
  the Browse screen to see just the drinks you can build right now. Home shows a
  live *"N you can make right now"* banner. Matching is smart: an **Assume I have
  the basics** switch (on by default) covers water/ice/citrus/sugar/sodas/
  garnishes/egg so the bar only tracks *bottles*, and sub-recipes recurse — a
  drink that needs Simple Syrup counts as makeable if you can make the syrup.
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

### Optional: Smart parse with Gemini (bring-your-own-key)

For messier descriptions you can enable AI parsing: **Settings → AI parsing**,
paste your own Google **Gemini** API key. It's stored **only in your browser's
localStorage** — never committed to this repo and never sent anywhere except
Google's API when you parse. The Import screen then offers **✨ Smart parse**
(Gemini structured output → the same `StructuredImport` pipeline), with the
offline heuristic always available as a fallback. All client-side; no backend.

A single video description usually holds **several cocktails**, so Smart parse
returns *all* of them: the preview becomes a **pick-list** ("N cocktails found")
where you tick which drinks to save. Syrups shared across drinks dedupe to a
single component automatically (name+kind) via the same `importRecipe` seam.

### Share a video straight to the app (Android)

On Android, "Add to Home Screen" installs the PWA as a real
[Web Share Target](https://developer.mozilla.org/docs/Web/Manifest/share_target):
tap **Share** on a YouTube video (or on selected description text) and pick
**Cocktail**. The share lands on the app's start URL as `?title&text&url`
params; `src/main.tsx` captures them at boot, stashes them
(`src/import/shared.ts`), and drops you into **Import** with the text prefilled
and auto-parsed. Sharing the bare video *link* only yields the URL/title (a
browser can't fetch a YouTube description — CORS), so for full ingredients share
the selected description text, or paste it. iOS Safari doesn't implement Web
Share Target, so there it stays copy-paste.

Security: create a key **restricted to the Generative Language API** so a leak
is low-impact. The whole feature is a **kill switch** — set `FEATURES.cloudAI`
to `false` in `src/config.ts` and redeploy to remove every AI entry point
(Settings gear, AI section, Smart-parse button), leaving the app exactly as it
was. Code is isolated to `src/import/gemini.ts`, `src/screens/SettingsScreen.tsx`,
and flag-gated blocks, so it also reverts cleanly with `git revert`.

### Roadmap: one-tap URL import (phase 2b)

Paste just a URL and have it auto-fetch + AI-parse. A browser can't fetch a
YouTube description directly (CORS), so this needs a small backend (e.g. a
Cloudflare Worker) plus an Anthropic API key. It reuses the same
`StructuredImport` contract — only the text-acquisition + parse step changes.
