# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

**Cocktail** is an offline-first PWA cocktail recipe book: browse drinks by base
spirit or tag, scale a recipe on the fly, keep personal notes, track a "My Bar"
inventory, and import recipes from pasted YouTube descriptions. All data lives in
the browser (IndexedDB + localStorage) — **no server holds your library, and
there is nothing to sign up for**. The app shell is cached by a service worker so
it works fully offline and installs to a phone's home screen.

The one exception, and it is deliberate: the **optional** AI features (smart
parse, shelf scan) call Gemini through Firebase and require a Google sign-in.
Everything else — every screen, every recipe, the whole library — works signed
out and offline, and must keep working that way. See "Optional cloud AI" below.

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

Both `npm run typecheck` and `npm test` are green on the current tree (222 tests).
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
    availability.ts  "Can I make this?" matching (staples + recursion + category substitution),
                  plus shelfKeys() / bottleCovers() / bottleFor() — the same rules asked about one pair
    spiritCategory.ts  categoryForName() — infers a spirit category from a bottle name (brands too)
    vocab.ts      TAGS / METHODS / GLASSES — the one list the prompt, editor and import picker share
    dupeMatch.ts  normalizeRecipeName() + shortlistCandidates() — local phase of duplicate detection
    spirits.ts    Spirit tile metadata, known-spirit order, generated art for custom spirits
    spiritVisual.ts  spiritVisual() — resolves a spirit to the redesign's tile colours/glyph
    search.ts     Recipe text search
    barInsights.ts   unlocksFor() / oneAwaySuggestions() / recipesUsingBottle() — "what does this
                  bottle unlock?" and "what does it pour into?", on-device
    bottleMatch.ts   Local near-duplicate detection for the shelf scan (candidates, verdicts)
    pantry.ts     Bar-scoped bottle add/remove/patch helpers (take a barId)
    bars.ts       Bar CRUD + ensureDefaultBar()
    textNormalize.ts  normalizeComponentName() + duplicateComponentGroups() (dedup/merge)
    recipeSummary.ts  Short ingredient summaries for cards
    recipeActions.ts  deleteRecipeWithConfirm (thin wrapper over import/importRecipe)
    ids.ts        newId()

  import/         The single write seam for bulk recipe creation
    types.ts      StructuredImport / RecipeDraft / IngredientDraft (tempId-based links)
    importRecipe.ts  importRecipe(), saveRecipe(), deleteRecipe(), setFavorite(), countUsage(), mergeComponents()
    aiShared.ts   Transport-agnostic AI core: response shapes + model-JSON → StructuredImport
    firebaseAI.ts Cloud transport via Firebase AI Logic: firebaseParse(), firebaseJudgeDuplicates(),
                  firebaseIdentifyBottles(), firebaseReconcileBottles()
    limits.ts     Cost ceilings on an AI request (input chars, photo count/bytes, output tokens)
    image.ts      Browser canvas downscale + data-URL split for the photo scan
    backup.ts     Whole-library export/import (the only way data crosses an origin)
    shared.ts     Android share-target stash/consume helpers

  auth/
    firebase.ts   Lazy Firebase bootstrap (App Check + Auth + AI Logic); sign-in/out; model handles
    analytics.ts  logAiCall() — one `ai_call` event per AI call. Counts only, never content

  hooks/
    useRecipes.ts   useLiveQuery reads (useCocktails, useRecipe, useBacklinks, usePantry(barId), useBars, useBottleCounts, useActiveBar, …)
    useAvailability.ts  Active bar's `have` set + the makeable check, for the screens
    useSettings.ts  localStorage-backed prefs (oz/ml, assumeStaples, activeBarId)
    useAuth.ts      Optional Google sign-in; `aiAvailable` is the single gate for AI features
    useWakeLock.ts  Holds the screen awake while a screen is mounted (recipe detail)

  screens/        One component per route (+ co-located *.module.css)
    HomeScreen, SearchScreen, BrowseScreen, RecipeDetailScreen,
    EditRecipeScreen, ImportScreen, SettingsScreen
    bar/          My Bar is the one screen with a folder — it owns four sheets:
                  BarScreen + ManageBarsSheet / AddBottleSheet / BottleSheet /
                  ScanReviewSheet, plus sheet.module.css for their shared chrome

  components/     Reusable UI (TabBar, RecipeRow, IngredientRow, AddSheet,
                  SearchLauncher, BottomSheet, ServingStepper, SwipeableRow,
                  ErrorBoundary, icons)
```

**Routes** (hash-based, see `main.tsx`): `/` (home), `/search`, `/browse`,
`/recipe/:id`, `/recipe/:id/edit`, `/new`, `/import`, `/bar`, `/settings`.

Query params carry the links *between* screens, so every one of them is a URL
someone can land on cold: `/bar?add=1` (open the bottle picker), `/bar?add=<name>`
(prefilled with what a recipe called for), `/bar?bottle=<key>` (open that bottle's
sheet), `/bar?scan=1`, `/browse?ingredient=<label>&family=<category>` (everything
this bottle pours into), `/browse?makeable=1`, `/search?q=`. `BarScreen` consumes
its params in an effect and strips them, so Back doesn't reopen a sheet.

Navigation is the persistent **`TabBar`** (Home · Search · add-FAB · Browse ·
My Bar). The FAB opens **`AddSheet`** over a **`BottomSheet`** — both are
buttons with `aria-label`s, not links, which matters when writing selectors.

**Every add goes through that FAB** — recipe *and* bottle. `AddSheet` is the only
menu of add actions in the app; the bottle rows just navigate to `/bar?add` /
`?scan` and let My Bar do the work. The Bar screen used to carry its own "Add a
bottle" and "Scan my shelf" cards next to the FAB, which made "which add is this
one?" a question the user had to answer. Don't add a second entry point; extend
this sheet.

**Search is one screen.** `SearchScreen` owns the only live search input in the
app; Home and Browse carry the same `SearchLauncher` pill into it. Browse's chips
filter what's already on screen — that's a different job, and it isn't search.

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
Every recipe source — the seed data today, the YouTube importer, the cloud AI
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
**v3** is the one real migration: multi-bar support moved bottles from the old
single `pantry` store (keyed on bare `name`) into a new bar-scoped `bottles`
store (compound key `[barId+name]`). IndexedDB can't re-key a store in place, so
the `.upgrade()` copies rows into `bottles` under a default "My Bar" and leaves
the dead `pantry` store untouched; fresh installs (which skip the upgrade) get
their default bar from `ensureDefaultBar()` at boot.

### State = the database
There is no separate app state store. Read data with the `useLiveQuery` hooks in
`hooks/useRecipes.ts`; mutate via the `import/importRecipe.ts` actions. UI updates
follow automatically because `useLiveQuery` re-runs on DB change. User
*preferences* (oz/ml, assume-staples, active bar) live in **localStorage** via
`hooks/useSettings.ts`, not IndexedDB.

### Non-destructive scaling
View-time serving rescale and per-ingredient nudges (`domain/scaling.ts`) never
mutate the stored `Ingredient.amount` — the original is preserved until the user
explicitly taps *Save to recipe*. Keep this invariant: `amount` is the authored
value; scaling is a display transform.

### Bars / "what can I make"
Users keep **multiple named bars** (My Bar, a friend's place, …) with exactly one
**active** at a time. Bars live in the `bars` store; bottles are scoped by `barId`
in `bottles`. The active bar id is in localStorage (`useActiveBarId`), resolved to
a real bar (falling back to the first) by `useActiveBar()`. All pantry mutations
(`domain/pantry.ts`) and `usePantry()` take a `barId`; Home/Browse/Detail read the
active bar's `have` set — the availability logic itself is bar-agnostic.
`usePantry()` deliberately loads only the active bar, so anything listing *every*
bar (the switcher, a delete confirmation) uses `useBottleCounts()` instead of
guessing.

A bottle is `{barId, name, label}` plus optional **`category`** and **`brand`**.
`category` is resolved once at write time (`categoryForName()` when the caller
didn't supply one) rather than re-inferred per render, and stays user-correctable
from the bottle sheet — the guess is good but not always right, and it decides
what the bottle substitutes for. `label` derives the primary key, so `updateBottle`
patches category/brand only; renaming is a remove + add.

**My Bar keeps two deliberately separate paths.** `AddBottleSheet` is the manual
one: it imports nothing from `import/` or `auth/` and must stay that way — it is
the path that works offline, signed out, forever. `ScanReviewSheet` is the AI one.
Both are reached from the FAB's `AddSheet` now rather than from buttons on the Bar
screen, but they are still two paths and the manual one still has to stand alone.
"What does this bottle unlock?" is answered by `domain/barInsights.ts` on both and
never involves AI.

A bottle nobody wrote a recipe for is a **first-class row** in `AddBottleSheet`,
not a quoted fallback: same shape as a suggested one, same type control, same
unlock count (a rye you typed covers every bourbon call, so the count is real).
Picked bottles the library never mentioned stay listed until you confirm.

`domain/availability.ts` matches a recipe's ingredients against that set. Three
rules keep it usable: an **assume-staples** switch (on by default, global) treats
water/ice/citrus/sugar/sodas/garnishes/egg and any no-amount garnish line as
on-hand; **sub-recipes recurse** (you can make a drink if you can make its syrup);
and **category substitution** — a generic bottle covers a specific call ("Jamaican
rum" is satisfied by any rum). Only base-spirit families in `MATCHABLE_CATEGORIES`
(from `spiritCategory.ts`) substitute — a Campari must never stand in for a
Chartreuse. Matching keys go through `normIngredient()`; category inference (also
used to group the Bar screen and label scanned bottles) goes through
`categoryForName()`.

**A shelf is a set of match keys, and a bottle contributes two** — its normalized
name *and* its family (`shelfKeys()`, used by `usePantry`). The family key is what
carries the stored category into matching. Without it, `categoriesOf` re-guessed
the family from the name alone, so correcting a bottle's type in the bottle sheet
changed a label and nothing else, and a "Smith & Cross" (which normalizes to
"smith cross") stocked no rum at all.

### Bottles and recipes point at each other
Availability is symmetric, and the UI has to be too — a recipe that says "any
whiskey works" and a bottle of rye that lists no recipes are the same rules
answered two different ways. So there is **one** matcher, and both directions call
it: **`bottleCovers(bottle, ingredient, category?)`** returns `'exact'`,
`'category'` or `null` by the same rules `makeable()` applies to a whole shelf.

- **Bottle → recipes.** `recipesUsingBottle()` (barInsights) lists every drink the
  bottle has a part in, sub-recipes included, ready-now ones first. "See all" goes
  to `/browse?ingredient=…&family=…` — the family travels so the full list matches
  what the sheet showed even when the user corrected a wrong guess.
- **Recipe → bottle.** `bottleFor()` finds the bottle on the shelf that covers an
  ingredient (exact first, then a same-family stand-in). `RecipeDetailScreen` links
  each line to `/bar?bottle=…`, noting *your Rittenhouse Rye* when it's a stand-in,
  and a missing line to `/bar?add=<what it calls for>`.

If you add a third way to ask "does this bottle count for this ingredient", make
it call `bottleCovers` — do not re-derive it from substring matching, which is
what the bottle sheet used to do and why it looked empty.

### Photo → bar (Gemini vision), in two passes
"Scan my shelf" downscales photos client-side (`import/image.ts`, max 4) and runs
**two** model calls with an on-device step between them. Gated on `auth.aiAvailable`.

1. **Vision.** `firebaseIdentifyBottles()` runs the `cocktail-vision-v1-0-0`
   template, passing photos as `{mimeType, contents}` variables, and returns
   `{name, brand?, category?, confidence?}` per bottle. `dedupeBottles()` cleans
   the list, with our `categoryForName()` still winning on category.
2. **Locally, no network.** `domain/bottleMatch.ts` decides which of the *user's own*
   bottles each detection is even worth comparing against: `exactMatch()` settles
   the easy ones, `closeCandidates()` picks at most five lookalikes for the rest.
3. **Reconcile.** `firebaseReconcileBottles()` asks the model to rule
   same / variant / new on those pairs. This is the call worth paying for —
   deciding that "Tanqueray No. Ten" is *not* "Tanqueray" is a judgement about
   bottles, not string distance.

Then `resolveDetections()` folds the three inputs into one row per bottle for the
review sheet, and confirming writes through `bulkAddPantry` with label, category
and brand.

Two properties hold and should keep holding:
- **Minimal egress.** Pass 2 sends detected names plus a handful of candidate
  labels — never the inventory — and `firebaseReconcileBottles` returns early
  when nothing has a candidate, so a scan into an empty bar still costs one call.
- **Pass 2 is an enhancement, not a dependency.** Like `firebaseJudgeDuplicates`,
  it never throws — it resolves to `[]` and `resolveDetections` falls back to the
  local verdicts. An exact string match is also never overruled by the model —
  it was never asked.

### Merging duplicate components
Imports can create near-duplicate syrups (a hand-added "Simple Syrup" plus an
imported "Semi Rich Simple Syrup"). `mergeComponents(fromId, toId)` (in the import
seam) repoints every parent's `subRecipeId`, rebuilds `recipeLinks`, and deletes
the loser in one transaction (with a cycle guard). Surfaced as a "Duplicate?" merge
picker on a component's detail screen. `normalizeComponentName()` /
`duplicateComponentGroups()` (`domain/textNormalize.ts`) detect likely dupes.

### Spirits are free-form
`Recipe.spirit` is an open string. `domain/spirits.ts` ships metadata (label,
emoji, gradient) for known spirits and **generates deterministic tile art** for
anything else, so a custom spirit (cachaça, pisco, sake) gets its own mosaic tile
without code changes. `'none'` is the sentinel for "no base spirit".

### Cloud AI — Firebase AI Logic, behind a sign-in
Two AI paths: **import** (description → recipes, wired in `ImportScreen`) and
**shelf scan** (photos → bottles, wired in `BarScreen`). Both
call **`src/import/firebaseAI.ts`**, which goes through **Firebase AI Logic** —
Google proxies the request and the Gemini key lives in the Firebase project, so
**no credential ships in this app or sits in a user's browser**. Each call runs a
**server prompt template**: the prompt, model, temperature and output ceiling live
in the Firebase project, so changing a prompt is a console edit rather than a
redeploy, and the project can refuse any request that isn't one of ours. Authored
copies of the four templates are in **`docs/prompt-templates/`** — edit there,
then paste — and the pure part left in **`src/import/aiShared.ts`** (response
shapes, model-JSON → `StructuredImport`) stays transport-agnostic.

Three gates, in order — all three must hold before an AI call happens:
1. `FEATURES.cloudAI` in `src/config.ts` — the **kill switch**, removes every entry point.
2. `isCloudAIConfigured()` — the `VITE_FIREBASE_*` build vars are present. Unset
   (a fork, a bare checkout) means the AI UI never appears and the SDK never loads.
3. `useAuth().aiAvailable` — the user is signed in with Google.

**Don't subscribe to auth eagerly.** `useAuth` deliberately does *not* boot
Firebase on mount: `BarScreen` calls it on a primary tab, and booting means the
SDK chunk plus App Check's reCAPTCHA handshake. It arms only for someone who has
signed in on this browser before (`cocktail.signedIn`) or who just clicked sign
in. `scripts/smoke.mjs` asserts the chunk is never fetched for a signed-out user
— if you change this hook, that check is what will catch you.

`vite.config.ts` keeps `firebase-*.js` in its own chunk and out of the SW
precache, for the same reason. Setup, console steps and the preview-channel
caveat are in **`docs/cloud-ai-backend.md`**.

**Import is the one gated feature.** There used to be an offline heuristic parser
(`parseRecipeText.ts`) as the signed-out default; it was deleted, because
maintaining two parsers meant a screen that apologised for whichever one you were
using. Signed out, `/import` is a sign-in panel and `AddSheet` hides the import
row when the build has no AI at all — `/new` (the manual editor) is the offline
path, and everything else in the app still works signed out and offline.

Import and the **shelf scan** are the *only two* gated entry points, and each has
an ungated twin doing the same job by hand, listed next to it in the same
`AddSheet`: *Build a recipe* for import, *Add a bottle* for the scan. Never gate a
third without saying so here, and never gate one without leaving a manual path to
the same result. `AddSheet` gates both rows on the **build** config only (never on
`useAuth`, which it must not boot from every screen); a signed-out tap on *Scan my
shelf* lands on My Bar, which offers the sign-in.

Rule that still holds: never introduce a repo-side secret.

**Measuring AI usage.** `auth/analytics.ts` logs one `ai_call` event per call that reached
the model — `kind`, `outcome`, `results` — so we can see what a real user consumes before
deciding any free allowance or price. Three invariants, all covered by `analytics.test.ts`:
it **never boots Firebase** (it reads the app a prior AI call initialized, which is what
keeps `useAuth`'s lazy boot and the smoke assertion honest), it **never throws or blocks**,
and it **never logs content** — no recipe or bottle names, no pasted text, no photos. The
library staying on the device has no exceptions, and a metrics pipeline is not one. Silent
without `VITE_FIREBASE_MEASUREMENT_ID`.

**Every AI call is capped, and the transport is where it's enforced.**
`import/limits.ts` owns the ceilings — pasted characters, photo count, bytes per
photo, `maxOutputTokens` per call — and `firebaseAI.ts` checks them *before*
reaching the model, so an over-long paste costs nothing. `downscaleDataUrl`
steps JPEG quality down to fit the byte budget rather than rejecting a photo, so
the transport's size check is a backstop that shouldn't fire.

They live in their own module for two reasons, both of which will bite if you
move them. `image.ts` needs the byte budget and is imported *eagerly* by the Bar
tab, so pulling the constants from `aiShared.ts` would drag its mappers into a
chunk that loads for everyone who opens My Bar. And when the AI calls
move behind a server proxy, that proxy has to enforce the same numbers — a limit
only the client knows is a limit the client can remove.

### Import: what the AI decides, and what it admits to guessing
`ImportScreen` makes **two** calls, and the second one is optional.

1. **`firebaseParse(text)`** → one `StructuredImport` per drink. Beyond the
   recipe, the model returns two preview-only fields (siblings of `main` on
   `StructuredImport`, never persisted — `draftToRecipe` is explicit-field):
   - **`guessed`** — which of method/glass/garnish/tags/spirit/kind it *inferred*
     rather than read. The prompt tells it to always fill those in; `guessed` is
     how the review screen marks them "✨". `mapAiRecipe` doesn't take the model's
     word for it: a value that appears verbatim in the source text is demoted out
     of `guessed`, and one that appears nowhere is promoted into it. Models are
     unreliable narrators about their own reasoning in both directions.
   - **`aka`** — other names for the drink, including the classic it riffs on.
2. **`firebaseJudgeDuplicates(queries)`** → relation verdicts. This runs *after*
   the preview renders and **never throws**; a failed check is a preview without
   badges, not a failed import.

The dedup split is deliberate. `domain/dupeMatch.ts` does a **local** lexical
shortlist over `useRecipeNameIndex()` first, so the only thing that reaches the
cloud is `{name, aka, candidates}` — a handful of names that already matched, and
nothing at all in the common case where nothing did. `aka` is what makes that
work without shipping the library: "Rum Sour" has no lexical overlap with
"Daiquiri", but its `aka` does. Judging on **identity, not proportions** is the
point — two bartenders' Daiquiris differ by a quarter ounce and are the same
drink, while a Hemingway Daiquiri is its own. A `same` verdict unchecks the card
so the obvious action can't create a duplicate; a `variation` only labels it.

Vocabularies live in **`domain/vocab.ts`** and the prompt is *built* from them.
They used to be three lists in three files that disagreed — don't re-fork them.

### Error resilience
`components/ErrorBoundary.tsx` wraps the router outlet and resets on route change,
so a screen that throws doesn't blank the whole app. Seeding failures are caught
in `main.tsx` and don't block boot.

## Testing conventions

- Tests are co-located (`*.test.ts(x)`) next to the code they cover.
- Environment is **jsdom**; `src/test/setup.ts` loads `@testing-library/jest-dom`
  and **`fake-indexeddb/auto`** so Dexie works in tests without a real browser.
- The strongest coverage is on the **pure domain logic** (`scaling`, `units`,
  `availability`, `dupeMatch`, `vocab`) and the **import pipeline** (`importRecipe`
  dedup/linking, `aiShared`, `firebaseAI`, `shared`) plus `useAuth`'s lazy-boot
  gate. New domain/import logic should come with a
  vitest test — that's the established pattern and the cheapest safety net.

### `scripts/smoke.mjs` — the one end-to-end check (Playwright)
Drives a **preview build** (`npm run build && npm run preview`, port `4173`)
through every screen, screenshots to `scripts/shots/` (gitignored), and asserts
the backup round trip: export a real file, wipe IndexedDB, re-import, same
recipes back. It also walks the FAB → *Add a bottle* → My Bar hand-off and both
directions of the bottle↔recipe link, using a bottle (Smith & Cross) no seeded
recipe names — so it only passes if the family rules are doing the work.
Prints ok/FAIL per check and exits non-zero.

> **Gotcha:** `go()` reloads, and `BarScreen` strips its query params as it
> consumes them, so a `goto` + `reload` of `#/bar?add=1` reloads the *stripped*
> URL and the sheet never opens. Load param URLs with a single `goto`.

```bash
npx playwright install chromium   # once per machine, not per checkout
node scripts/smoke.mjs
```

Playwright is a devDependency, so `npm install` in any worktree is enough. The
browser is the expensive part, and it is deliberately *not* installed by `npm
ci`: the deploy workflow sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, because no
CI job opens a browser. Locally the browsers cache outside the repo
(`~/Library/Caches/ms-playwright`), so one download serves every checkout. The
script still falls back to the system Chrome if that cache is empty.

> This replaced sixteen per-feature `verify-*.mjs` scripts that had all rotted
> (dead `executablePath`, pre-redesign selectors). **Extend this one** rather
> than adding `verify-yourfeature.mjs` — that's how the last set went stale.

> **Gotcha:** the app is hash-routed, so `page.goto()` between two `#/…` URLs is
> a *same-document* navigation. The browser doesn't reload and React state (an
> open sheet) leaks into the next screen. `go()` reloads explicitly for this.

## Build & deploy

- **Firebase Hosting** via `.github/workflows/deploy.yml`: push to `main` →
  typecheck, test, build, deploy to the **live** channel. Every PR gets its own
  auto-expiring **preview channel** URL, which is how you try a branch on a
  phone (this replaced a scheme that published a second copy of the whole app
  side-by-side under `/cocktail/v2/`).
- **Base path is `/`** and hard-coded in `vite.config.ts`. It used to be a
  CI-injected `BASE_PATH`, because Pages served the project under `/cocktail/`
  and the manifest's `start_url` / `scope` / `share_target.action` all derived
  from it. Hosting serves at the root, so all of that is gone — don't
  reintroduce it.
- **`firebase.json`** pins Cache-Control: `no-cache` on the entry point, `sw.js`
  and the manifest; `immutable` on Vite's content-hashed `assets/`. This is not
  incidental — a cached service worker is what pinned the old Pages deploy to a
  dead build. Header rules are ordered broad-first, specific-last (last match
  wins). Verify changes with `firebase emulators:start --only hosting` (port
  5055; not the default 5000, which macOS AirPlay squats on).
- **Hash routing** (`createHashRouter`) predates Hosting and stays: installed
  PWAs and shared links keep working. `firebase.json` already has the SPA
  rewrite if it ever changes.
- **GitHub Pages is fully retired.** The app used to be served from
  `horneth.github.io/cocktail/`; that origin ran a farewell page (a
  self-destructing service worker plus a data-export button) through the
  migration and has since been shut down. There is no Pages workflow, no
  `gh-pages` branch and no Pages environment — if you find something referring
  to any of them, it's dead weight.
- **PWA**: `registerType: 'autoUpdate'`. The manifest declares an Android **Web
  Share Target** (`share_target`) so "Share" on a YouTube video can open the app;
  `main.tsx` captures the `?title&text&url` params at boot, `import/shared.ts`
  stashes them, and the user lands in Import prefilled.

### Moving data between devices
`src/import/backup.ts` is the only path in or out. `exportBackup()` writes a
versioned envelope (`{app, version, exportedAt, data, settings}`) covering all
four Dexie stores plus the portable prefs; `importBackup()` **replaces** the
library in one transaction. Two invariants worth keeping:
- **`PORTABLE_SETTINGS` is an allowlist, not a `cocktail.*` sweep.** A backup file
  ends up in email and cloud storage, so credentials and session state must never
  ride along. That kept the old BYO Gemini key out; it now keeps
  `cocktail.signedIn` out, which is device-local anyway.
- **Bump `BACKUP_VERSION` and keep reading v1** if the envelope changes.
  `parseBackup()` rejects anything newer than it knows, so a file exported today
  has to stay loadable — this is the only copy some libraries have.

## Conventions & gotchas

- **TypeScript is strict.** Prefer explicit domain types from `db/schema.ts` and
  `import/types.ts`; avoid `any`.
- **Keep `domain/` pure** — no React, no Dexie imports there. It's the tested
  core. DB access belongs in `hooks/` (reads) and `import/importRecipe.ts`
  (writes).
- **CSS Modules** per component/screen; global tokens live in `theme.css`. The
  theme is the "Nightcap" warm-paper light palette (`theme_color: #F6F4EF`) —
  use the tokens (`--paper`, `--ink`, `--accent`, `--danger`, …), not literals.
- **IDs** come from `domain/ids.ts` (`newId()`) — don't hand-roll ids.
- **No explanatory subtitles under UI labels.** A button that says *Import a
  recipe* does not need "Paste text — we pull out the recipe" underneath it, and
  *Scan my shelf* does not need "Snap a photo — we read the rest". People know
  what import means. This filler reads like a landing page, makes the app look
  amateurish, and it is the first thing to delete when a screen feels cluttered —
  the whole `AddSheet` sub-line set and its `.optSub` styles were removed for
  exactly this reason. Write **one** label and stop.
  Text earns its place only when it answers a question the user actually has at
  that moment — *why does this need my Google account* on the import sign-in
  panel, or *what will this overwrite* before a destructive action. If you can't
  name the question, cut the sentence. The same goes for the AI's own voice:
  never narrate what the app is about to do, and never apologise for it.
- **No decorative CTAs.** A big button that only scrolls the page down (the
  recipe screen's old *Start making*) costs a fixed strip of every screen and
  does nothing a thumb wasn't already doing. Same instinct as the subtitles: if
  you can't say what tapping it changes, it isn't a button.
- **A count is a line, not a billboard.** "N drinks you can make" is a fact worth
  one row on Home and one line in My Bar's header — it was a full-width accent
  card in both places, which turned every visit into an argument about the size
  of your bar.
- **A recipe holds the screen awake** (`useWakeLock` on `RecipeDetailScreen`).
  You read it with wet hands and no free thumb; the auto-dim lands around the
  second ingredient. Best-effort — an unsupported browser or a refused request
  just behaves as before.
- **Comments in this codebase explain *why*** (invariants, edge cases,
  history). Match that: comment the non-obvious reasoning, not the obvious code.
- No secrets in the repo, ever. The Gemini key lives in the Firebase project and
  is never seen by this app. The `VITE_FIREBASE_*` / `VITE_RECAPTCHA_SITE_KEY`
  build vars *are* in the client bundle on purpose — that is public client
  config, which is why CI passes them as repo **Variables**, not Secrets.

## Git workflow for AI assistants

- **`main` is the branch.** It is the default branch and what CI deploys from.
  Work on a topic branch and never push to a different long-lived branch without
  explicit permission.
- The repo previously had no `main` at all: the default was
  `claude/cocktail-recipe-app-zf5owl` (the pre-redesign UI) with the redesign
  living on a separate `v2` branch that CI published side-by-side. Both are gone.
  If you find a reference to either, it's stale.
- Do **not** open a pull request unless explicitly asked.
- Write focused commits with clear messages describing the *why* (the existing
  history is a good model: "Recover from render errors instead of blank-screening",
  "Free-form / custom spirits (fixes cachaça mis-categorized as rum)").
