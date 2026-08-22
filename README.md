# 🍸 Cocktail

**<https://cocktails-c2705.web.app>**

A fast, offline, install-to-your-phone cocktail recipe book. Open it, pick a
drink, and build it in seconds. Tweak measurements on the fly, keep personal
notes, and link recipes together — a syrup or cordial you make once pours into
every drink that calls for it.

Built as a **PWA** — a web app you can "Add to Home Screen" that works fully
offline with all data stored locally on your device. No server holds your
library, and nothing needs an account (the optional AI features ask for a Google
sign-in; everything else never does).

## Highlights

- **Opens on what you can pour** — home leads with a live *"N drinks you can
  make right now"* card for your active bar, then spirit cards and what you
  added recently. A bottom tab bar (Home · Search · Browse · My Bar) with a
  center **+** is always in reach.
- **Browse by spirit or tag** — everything funnels into one `/browse` view
  driven by the URL (`scope` + `tags`): a spirit card scopes to that spirit, a
  tag pill filters across *all* spirits, and the tag picker is **multi-select**
  (AND) — e.g. all *refreshing + citrusy* drinks. "All", "Favorites" and
  "Syrups & cordials" get their own entries. **Spirits are free-form** — type any
  base spirit (cachaça, pisco, sake…) in the editor or import preview and it
  gets its own generated art; the import keeps the specific spirit a recipe
  names rather than collapsing it.
- **My Bar(s) & "what can I make"** — tell the app which bottles you actually
  have (your shelf at `/bar`, grouped by spirit), then flip **Only what I can
  make** on the Browse screen to see just the drinks you can build right now.
  Home shows a live *"N you can make right now"* banner. Adding a bottle shows
  what it unlocks before you commit, and **Worth buying next** names the one
  bottle standing between you and the most new drinks — all worked out on your
  device, no account needed. Keep **several bars** — "My Bar" plus a friend's
  place or a travel kit — and switch the active one; "what I can make" follows.
  You can also **scan your shelf**: snap a photo and AI reads the labels, works
  out which bottles you already have and which are near-variants of them, and
  hands you a list to confirm (opt-in, needs a Google sign-in).
  Matching is smart: an **Assume I have the basics** switch (on by default)
  covers water/ice/citrus/sugar/sodas/garnishes/egg so the bar only tracks
  *bottles*; linked syrups/cordials recurse (a drink that needs Simple Syrup
  counts if you can make the syrup); and a **generic bottle covers a specific
  call** — any rum
  satisfies a recipe that asks for "Jamaican rum", any whiskey covers "Woodford
  Reserve".
- **Instant, offline** — recipes live in IndexedDB and the app shell is cached
  by a service worker, so cold-open to recipe is sub-second and works with no
  network.
- **Build-it-now detail view** — a big serving stepper rescales the whole drink
  instantly; tap any single amount to nudge it. Amounts render as bar fractions
  (¾ oz) with an oz ⇄ ml toggle.
- **Non-destructive tweaks** — scaling and per-ingredient nudges never touch the
  stored recipe unless you tap *Save to recipe*.
- **Cross-linked recipes** — a syrup or cordial is a first-class recipe. Tap
  through from a cocktail to its Simple Syrup and back; each mixer shows a
  *Used in* list of every drink that references it. Link an ingredient to a
  recipe by name-autocomplete in the editor — nothing gets invented for you.
- **Parts & volumes** — recipes can be absolute (2 oz, ¾ oz) or ratio-based
  (1 part : 1 part), with a per-part volume selector.
- **Your data is yours, and portable** — everything lives in your browser, so
  **Settings → Your data** exports the whole library (recipes, notes, bars,
  preferences) to a JSON file and imports it back on another device. Your API
  key is never written to the file.

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
npm test           # vitest — units, scaling, import/link dedup, backup
npm run typecheck
```

Regenerate PWA icons from the SVG source: `node scripts/make-icons.mjs`.

End-to-end smoke check against a preview build (needs `npm i -D playwright`
once — it's deliberately not a repo dependency):

```bash
node scripts/smoke.mjs
```

## Deploy

Live at **<https://cocktails-c2705.web.app>**, on Firebase Hosting. Pushing to
`main` runs typecheck + tests + build and deploys; every pull request gets its
own temporary preview URL.

> Moving to a new phone or browser? Because storage is scoped per browser, your
> recipes don't follow automatically — use **Settings → Your data** to export a
> backup file and import it on the other device.

## Data model (one entity, cross-linked)

A cocktail, a syrup and a cordial are the **same** `Recipe`, distinguished only
by `kind: 'cocktail' | 'syrup' | 'cordial'`. An ingredient carries an optional
`recipeId` that points at another recipe (a syrup, say); a denormalized
`recipeLinks` table indexes that relationship both ways (for fast *Used in*
back-links and duplicate-merge). See `src/db/schema.ts`.

## Import a recipe

Tap **Import**, paste a recipe or a whole video description, and Gemini turns it
into one recipe per cocktail, syrup or cordial it finds — each through the same
`importRecipe(StructuredImport)` seam the seed data uses. A single description
usually holds **several** recipes; you get all of them, each as a card you can
review, edit and tick before anything is saved. Import never invents or links
sub-recipes: a cocktail that calls for "Simple Syrup" just lists it, and you
link it to your syrup recipe later in the editor, by name-autocomplete.

**It fills in the blanks, and tells you where.** Build, glass, garnish and tags
come from the text when the text says; otherwise the model infers the standard
serve for that drink and flags what it inferred with a **✨**. Tap any flagged
field to correct it and the mark clears. Ingredients and amounts are never
guessed — those only ever come from what you pasted.

**It knows what you already own.** Before importing, each drink is matched
against your library and labelled *Already in your library* (unticked, so you
can't create a duplicate by accident) or *Variation of …* (a Hemingway Daiquiri
is its own drink, not a second Daiquiri). Matching is on the drink's **identity**
rather than its exact specs — two bartenders' Daiquiris differ by a quarter ounce
and are still the same drink, and a Daiquiri pasted in as "Rum Sour" is still
caught. Your library isn't uploaded to do this: the candidates are found on your
device first, and only a handful of already-matching *names* are ever sent.

`Recipe.source` records provenance, including the YouTube URL and video id when
one is in the pasted text.

### Import needs a Google sign-in

Import is the one feature that does. **Sign in with Google** (from **Settings →
AI features**, or the panel on the Import screen) to use it. There is **no API
key to paste and nothing sensitive stored in your browser** — the request goes
through Firebase AI Logic, where Google runs the proxy and the Gemini key lives
in the Firebase project, never in this app. The sign-in exists so usage can be
rate-limited per account; it is not an account for your recipes.

Your library stays entirely on your device either way. Browsing, searching,
editing, **My Bar**, notes, scaling and backups all work signed out and offline,
and you can always add a recipe by hand.

### Share a video straight to the app (Android)

On Android, "Add to Home Screen" installs the PWA as a real
[Web Share Target](https://developer.mozilla.org/docs/Web/Manifest/share_target):
tap **Share** on a YouTube video (or on selected description text) and pick
**Cocktail**. The share lands on the app's start URL as `?title&text&url`
params; `src/main.tsx` captures them at boot, stashes them
(`src/import/shared.ts`), and drops you into **Import** with the text prefilled
and extracted. Sharing the bare video *link* only yields the URL/title (a
browser can't fetch a YouTube description — CORS), so for full ingredients share
the selected description text, or paste it. iOS Safari doesn't implement Web
Share Target, so there it stays copy-paste.

The whole feature is a **kill switch** — set `FEATURES.cloudAI` to `false` in
`src/config.ts` and redeploy to remove every AI entry point, leaving the app
exactly as it was. It also disappears on its own in any build without the
`VITE_FIREBASE_*` variables, so a fork or a bare `npm run build` gets a pure
offline recipe book with no dead UI. Code is isolated to `src/auth/firebase.ts`,
`src/import/firebaseAI.ts`, `src/hooks/useAuth.ts` and flag-gated blocks. The
Firebase SDK is a separate chunk that is never downloaded until you actually
sign in — being signed out costs nothing. Setup notes:
[`docs/cloud-ai-backend.md`](docs/cloud-ai-backend.md).

### Roadmap: one-tap URL import (phase 2b)

Paste just a URL and have it auto-fetch + AI-parse. A browser can't fetch a
YouTube description directly (CORS), so this needs a small backend (e.g. a
Cloudflare Worker) plus an Anthropic API key. It reuses the same
`StructuredImport` contract — only the text-acquisition + parse step changes.
