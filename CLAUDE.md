# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

**Cocktail** is an offline-first PWA cocktail recipe book: browse drinks by base
spirit or tag, scale a recipe on the fly, keep personal notes, track a "My Bar"
inventory, and import recipes from pasted YouTube descriptions. It is a pure
client-side app — **no backend, no accounts, no server**. All data lives in the
browser (IndexedDB + localStorage), and the app shell is cached by a service
worker so it works fully offline and installs to a phone's home screen.

The user-facing story lives in `README.md`; this file is the map for *changing*
the code.

## Stack

- **React 19** + **TypeScript** (strict) + **Vite 6**
- **Dexie 4** (IndexedDB wrapper) with **`useLiveQuery`** (`dexie-react-hooks`)
  as the *only* state layer — there is no Redux/Zustand/Context store. Components
  subscribe to the DB and re-render reactively.
- **react-router 7** in **hash-router** mode (`createHashRouter`)
- **vite-plugin-pwa** (Workbox) for the service worker + manifest
- **CSS Modules** (`*.module.css`) for styling; global theme in `src/theme.css`
- **Vitest** + **@testing-library/react** + **fake-indexeddb** for tests
- Deliberately few dependencies. Prefer keeping it that way — reach for a new
  dependency only when there's a real reason.

## Commands

```bash
npm install
npm run dev        # vite dev server on http://localhost:5173 (SW enabled in dev)
npm run build      # tsc -b && vite build  → dist/ (production + service worker)
npm run preview    # serve the production build on :4173 (test install/offline here)
npm test           # vitest run — units, scaling, import/link dedup, parsing
npm run test:watch # vitest in watch mode
npm run typecheck  # tsc -b --noEmit
```

Both `npm run typecheck` and `npm test` are green on the current tree (69 tests).
Run them before committing — they are the fast feedback loop. There is **no
linter/formatter** configured; match the surrounding code style.

Regenerate PWA icons from the SVG source: `node scripts/make-icons.mjs`.

## Architecture & directory map

```
src/
  main.tsx        Entry: hash router, route table, seed-if-empty, Android share-target capture
  App.tsx         Root layout: <Outlet/> wrapped in ErrorBoundary; cold-start share redirect
  config.ts       FEATURES kill-switch flags (e.g. cloudAI)
  theme.css       Global CSS variables / base styles

  db/
    schema.ts     Core domain types (Recipe, Ingredient, PantryItem, RecipeLink, …)
    db.ts         Dexie subclass + versioned store definitions (the ONLY DB instance)
    seed.ts       Starter recipes, authored as StructuredImport, written via importRecipe()

  domain/         Pure, framework-free logic — unit-tested, no React, no Dexie imports
    scaling.ts    Serving rescale + per-ingredient nudge (non-destructive)
    units.ts      oz⇄ml conversion, bar-fraction rendering (¾ oz)
    availability.ts  "Can I make this?" matching against My Bar (staples + recursion)
    spirits.ts    Spirit tile metadata, known-spirit order, generated art for custom spirits
    search.ts     Recipe text search
    pantry.ts     My Bar add/remove helpers
    recipeSummary.ts  Short ingredient summaries for cards
    recipeActions.ts  deleteRecipeWithConfirm (thin wrapper over import/importRecipe)
    ids.ts        newId()

  import/         The single write seam for bulk recipe creation
    types.ts      StructuredImport / RecipeDraft / IngredientDraft (tempId-based links)
    importRecipe.ts  importRecipe(), saveRecipe(), deleteRecipe(), setFavorite(), countUsage()
    parseRecipeText.ts  Offline heuristic parser (pasted description → StructuredImport)
    gemini.ts     Optional BYO-key Gemini "smart parse" (flag-gated, client-side)
    shared.ts     Android share-target stash/consume helpers
    parsers/      Channel-specific parsing (andersErickson.ts)

  hooks/
    useRecipes.ts   useLiveQuery-based reads (useCocktails, useRecipe, useBacklinks, usePantry, …)
    useSettings.ts  localStorage-backed prefs (oz/ml, assumeStaples, Gemini key/model)

  screens/        One component per route (+ co-located *.module.css)
    HomeScreen, BrowseScreen, RecipeDetailScreen, EditRecipeScreen,
    ImportScreen, BarScreen, SettingsScreen

  components/     Reusable UI (RecipeCard, IngredientRow, ServingStepper,
                  SwipeableRow, ErrorBoundary, icons)
```

**Routes** (hash-based, see `main.tsx`): `/` (home), `/browse`, `/recipe/:id`,
`/recipe/:id/edit`, `/new`, `/import`, `/bar`, `/settings`.

## Key concepts — read these before making changes

### One entity, cross-linked (the data model)
A **cocktail and a syrup are the same `Recipe`**, distinguished by
`kind: 'cocktail' | 'component'`. Components (syrups, cordials, orgeats) are
first-class recipes that other recipes reference via `Ingredient.subRecipeId`.
A denormalized **`recipeLinks`** table indexes that parent↔child relationship
both ways, powering fast "Used in" back-links and shared-component dedup.
`recipeLinks` is an *index, rebuildable from `recipes` alone* — never treat it as
a second source of truth. See `src/db/schema.ts`.

### The import seam is the only bulk write path
Every recipe source — the seed data today, the YouTube importer, the Gemini
parser — produces a **`StructuredImport`** and goes through
**`importRecipe()`** (`src/import/importRecipe.ts`). It runs in a single Dexie
transaction: inserts/reuses components (deduped by `name`+`kind`), resolves
`tempId` refs to real ids, inserts the main recipe, and reconciles `recipeLinks`.
When adding a new import source, target `StructuredImport` — do not write to the
DB directly. Single-recipe edits from the editor go through **`saveRecipe()`**
(also link-reconciling); deletes through **`deleteRecipe()`** (strips dangling
`subRecipeId`s from parents).

### Dexie schema evolution is additive
Only **indexed** fields are declared in `db.ts`; full objects are stored as JSON
regardless. New optional fields (e.g. `source`) drop into the type with **no
schema bump / no migration**. Add a store or index only via a new
`this.version(N).stores({...})` block — this keeps existing user data intact.

### State = the database
There is no separate app state store. Read data with the `useLiveQuery` hooks in
`hooks/useRecipes.ts`; mutate via the `import/importRecipe.ts` actions. UI updates
follow automatically because `useLiveQuery` re-runs on DB change. User
*preferences* (oz/ml, assume-staples, Gemini key) live in **localStorage** via
`hooks/useSettings.ts`, not IndexedDB.

### Non-destructive scaling
View-time serving rescale and per-ingredient nudges (`domain/scaling.ts`) never
mutate the stored `Ingredient.amount` — the original is preserved until the user
explicitly taps *Save to recipe*. Keep this invariant: `amount` is the authored
value; scaling is a display transform.

### My Bar / "what can I make"
`domain/availability.ts` matches a recipe's ingredients against the user's bar
(a set of normalized names). Two rules keep it usable: an **assume-staples**
switch (on by default) treats water/ice/citrus/sugar/sodas/garnishes/egg and any
no-amount garnish line as on-hand, and **sub-recipes recurse** (you can make a
drink if you can make its syrup). Matching keys go through `normIngredient()`.

### Spirits are free-form
`Recipe.spirit` is an open string. `domain/spirits.ts` ships metadata (label,
emoji, gradient) for known spirits and **generates deterministic tile art** for
anything else, so a custom spirit (cachaça, pisco, sake) gets its own mosaic tile
without code changes. `'none'` is the sentinel for "no base spirit".

### Optional Gemini "smart parse" — flag-gated, BYO-key
An opt-in AI parse path (`src/import/gemini.ts`, wired in `SettingsScreen` /
`ImportScreen`) uses a **user-supplied** Gemini key stored **only in
localStorage** — never committed, never sent anywhere but Google's API. It is a
**kill switch**: set `FEATURES.cloudAI = false` in `src/config.ts` and redeploy to
remove every AI entry point. When touching AI code, keep it isolated behind that
flag and never introduce a repo-side secret or backend.

### Error resilience
`components/ErrorBoundary.tsx` wraps the router outlet and resets on route change,
so a screen that throws doesn't blank the whole app. Seeding failures are caught
in `main.tsx` and don't block boot.

## Testing conventions

- Tests are co-located (`*.test.ts(x)`) next to the code they cover.
- Environment is **jsdom**; `src/test/setup.ts` loads `@testing-library/jest-dom`
  and **`fake-indexeddb/auto`** so Dexie works in tests without a real browser.
- The strongest coverage is on the **pure domain logic** (`scaling`, `units`,
  `availability`) and the **import pipeline** (`parseRecipeText`, `importRecipe`
  dedup/linking, `gemini`, `shared`). New domain/import logic should come with a
  vitest test — that's the established pattern and the cheapest safety net.

### End-to-end `verify-*.mjs` scripts (Playwright)
`scripts/verify*.mjs` are throwaway Playwright smoke checks written per feature
(one per PR/feature: `verify-mybar.mjs`, `verify-tags.mjs`, …). They drive a
**preview build** (`npm run build && npm run preview`, port `4173`) and screenshot
to `scripts/shots/` (gitignored). They are **not** part of `npm test` and are not
CI-gated — treat them as manual/dev harnesses.

> **Gotcha:** these scripts hardcode `executablePath:
> '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`. In this environment the
> browser is at `/opt/pw-browsers/chromium` (and `PLAYWRIGHT_BROWSERS_PATH` is
> preset). Point `executablePath` at the available binary — or drop it and let
> Playwright resolve — if you run one. Do **not** run `playwright install`.

## Build & deploy

- **GitHub Pages** via `.github/workflows/deploy.yml`. It builds on push to the
  `claude/cocktail-recipe-app-zf5owl` branch (the effective main line of this
  repo) with `BASE_PATH=/cocktail/`, then deploys `dist/` to Pages.
- **Base path**: Pages serves the project under `/cocktail/`. `vite.config.ts`
  reads `process.env.BASE_PATH` (default `/`), and the PWA manifest's
  `start_url` / `scope` / `share_target.action` all derive from it. Local dev
  stays at `/`. Hash routing (`createHashRouter`) is what makes deep links and
  refreshes work on Pages without 404s.
- **PWA**: `registerType: 'autoUpdate'`. The manifest declares an Android **Web
  Share Target** (`share_target`) so "Share" on a YouTube video can open the app;
  `main.tsx` captures the `?title&text&url` params at boot, `import/shared.ts`
  stashes them, and the user lands in Import prefilled.

## Conventions & gotchas

- **TypeScript is strict.** Prefer explicit domain types from `db/schema.ts` and
  `import/types.ts`; avoid `any`.
- **Keep `domain/` pure** — no React, no Dexie imports there. It's the tested
  core. DB access belongs in `hooks/` (reads) and `import/importRecipe.ts`
  (writes).
- **CSS Modules** per component/screen; global tokens live in `theme.css`. The
  theme is dark (`theme_color: #1a1220`).
- **IDs** come from `domain/ids.ts` (`newId()`) — don't hand-roll ids.
- **Comments in this codebase explain *why*** (invariants, edge cases,
  history). Match that: comment the non-obvious reasoning, not the obvious code.
- No secrets in the repo, ever. The only credential path (Gemini) is
  user-supplied and browser-local by design.

## Git workflow for AI assistants

- The active development branch for this repo is
  **`claude/cocktail-recipe-app-zf5owl`** (what CI deploys from). Confirm the
  branch you were asked to work on before pushing, and never push to a different
  branch without explicit permission.
- Do **not** open a pull request unless explicitly asked.
- Write focused commits with clear messages describing the *why* (the existing
  history is a good model: "Recover from render errors instead of blank-screening",
  "Free-form / custom spirits (fixes cachaça mis-categorized as rum)").
