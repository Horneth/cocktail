# Cloud AI as a first-class backend — decision & setup

_Status: **implemented**. Decision record + setup guide. Written 2026-07, updated 2026-08 after
the move from GitHub Pages to Firebase Hosting._

## Why change the previous model

Cloud AI used to be **bring-your-own-key**: each user pasted a Gemini API key into
`localStorage` (`cocktail.geminiKey`) and the browser called Google directly
(`src/import/gemini.ts`). That's fine for a personal tool but not "first-class."

Decision: if cloud AI stays a first-class feature it gets first-class support —

- **No API key handled by the app.** The Gemini key never ships in client code.
- **Optional user login** (Google). The whole app works logged-out; **only the AI features
  require sign-in.**
- **AI calls go through a managed backend.**
- **Free to run**, deployable without a paid plan.

> This is a deliberate departure from the repo's current "no backend / no accounts" principle
> in `CLAUDE.md`. It's an intentional product decision scoped **only** to the AI features —
> everything else stays local-first and offline.

## Recommendation — Firebase AI Logic + Firebase Auth + App Check

The simplest free path that meets every requirement **without writing or hosting our own
backend**: Google runs the proxy and the Gemini key stays server-side. It landed in the same
Firebase project that already serves the app, which is what makes the setup below as short as
it is.

- **Firebase AI Logic** (GA, JS/web SDK) — the client calls Gemini through Google's proxy, so
  there's **no API key in client code and no server for us to write**. Uses the **Gemini
  Developer API** provider on the **free Spark plan** (no Cloud Billing account). It supports
  the same `responseSchema` / `responseMimeType: 'application/json'` structured output we
  already rely on, so our schemas and prompts carry over unchanged.
- **Firebase Authentication** — Google sign-in (popup or redirect). Free, and works from any
  origin as long as the domain is on the **Authorized domains** list. Since this memo was
  written the app moved to **Firebase Hosting in the same project** (`cocktails-c2705`), so
  `cocktails-c2705.web.app` and `.firebaseapp.com` are authorized automatically.
- **Firebase App Check** (reCAPTCHA v3, free) — **mandatory for AI Logic as of July 2026**.
  It attests that requests come from the real app; App Check tokens are single-use (replay
  protection, May 2026).

### Per-user usage control

This was the main open question, and Firebase AI Logic handles the common case natively:

- **Built in:** a **per-user rate limit**, default **100 requests/minute per user per region**,
  **adjustable down** in the Google Cloud console (Firebase AI Logic API → Quotas; requires the
  `serviceusage.quotas.update` permission). It's enforced against the **authenticated user** —
  which is exactly why requiring login makes per-user throttling meaningful — on top of App
  Check attesting the app.
- **Not built in:** per-user **daily/monthly volume caps or cost budgets**, and
  tiered/monetized quotas. If we ever want hard daily caps, add a small **Cloud Functions +
  Firestore counter** layer (still free-tier) that's checked before the AI call. **Deferred** —
  start with the built-in RPM quota + App Check + login gate, and only add metering if abuse
  actually shows up. This is the one and only reason we'd write server code here.

### Alternative (only if we outgrow managed)

A **thin serverless proxy** (Cloudflare Workers / Vercel / Deno Deploy free tier) that verifies
a Google ID token and forwards to Gemini with a server-held key — full control and native
per-user daily metering, at the cost of building, hosting, and securing it ourselves and
managing the secret. Kept as an escape hatch, not the first move.

## What changed in the app (shipped)

- **Deps:** `firebase` (modular imports: `firebase/app`, `firebase/auth`, `firebase/ai`,
  `firebase/app-check`). `vite.config.ts` splits it into its own `firebase-*.js` chunk and
  `globIgnores` keeps that chunk **out of the service-worker precache** — an offline recipe
  book shouldn't ship 350 KB of SDK to everyone on first install.
- **`src/import/firebaseAI.ts`** replaced the raw `fetch` transport:
  `getAI()` → `getGenerativeModel({ model, generationConfig: { responseMimeType, responseSchema } })`
  → `generateContent(parts)`. `firebaseParse` / `firebaseIdentifyBottles` /
  `firebaseReconcileBottles` take no key. `toFirebaseSchema()` converts our OpenAPI-subset
  schema to the SDK's `Schema` builder. Everything downstream (mappers, prompts,
  `StructuredImport`) is unchanged and lives in `src/import/aiShared.ts`. Vision still
  sends `inlineData` parts via `splitDataUrl`.
- **Shelf scan is two calls, not one** (see CLAUDE.md, "Photo → bar"): vision, then a
  tiny text-only `firebaseReconcileBottles` that rules same/variant/new on bottles the
  user might already own. Its payload is picked on-device by `domain/bottleMatch.ts` and
  carries only the detected names plus a handful of candidate labels — the inventory
  never leaves the browser — and the call is skipped entirely when nothing is close, so
  a first scan into an empty bar costs exactly one request. It is also non-blocking:
  a failure degrades to the local verdicts rather than breaking the scan.
- **`src/auth/firebase.ts`** initializes the app + App Check + Auth once, all behind dynamic
  `import()`s, and exposes `signInWithGoogle()` / `signOutUser()` / `getGeminiModel()`. The
  Firebase config values (`apiKey`, `projectId`, `appId`, …) are **public client config, not
  secrets**. The real Gemini key lives in the Firebase project and never ships.
- **`src/hooks/useAuth.ts`** is the gate: `aiAvailable = configured && signed in`. It does
  **not** subscribe on mount — see "Lazy boot" below.
- **`src/config.ts`:** `FEATURES.cloudAI` is still the kill switch; the Firebase config reads
  from `VITE_FIREBASE_*` env vars, and `isCloudAIConfigured()` hides the AI UI entirely when
  they're unset. Nothing project-specific is hard-coded.
- **`src/import/gemini.ts` is gone**, along with `useGeminiSettings`. `main.tsx` deletes
  `cocktail.geminiKey` / `cocktail.geminiModel` on boot so the retired credential doesn't sit
  in existing installs forever.
- **UI:** `ImportScreen` / `BarScreen` show a sign-in prompt where the "set your key" nudge
  used to be; `SettingsScreen` shows the account and a sign-out. Import is AI-only (the offline
  `parseRecipeText` heuristic was deleted), so signed out `/import` is a sign-in panel and
  `AddSheet` hides the row entirely on a build with no Firebase config. `/new` is the offline
  path in; every non-import feature must keep working signed out.

### The four calls a backend has to implement

A replacement transport needs **all four** entry points in `src/import/firebaseAI.ts` — the pure
schemas, prompts and mappers for each live in `aiShared.ts` and should be reused verbatim.
Note the symmetry: import and shelf scan are each a *heavy* first call followed by an
*optional, must-not-throw* second call whose payload a local pass already shortlisted.

1. `firebaseParse(text) → StructuredImport[]` — `PROMPT` + `RESPONSE_SCHEMA`, through
   `finishParse(json, text)`. Beyond the recipes it yields preview-only `guessed` and `aka`.
2. `firebaseJudgeDuplicates(queries) → DupeVerdict[]` — `DUPE_PROMPT` + `DUPE_SCHEMA`, through
   `finishDupeJudgement(json, queries)`. **Must not throw**: the import screen fires it after
   the preview is already on screen, and an error means "no badges", not a failed import.
   The payload is only `{index, name, aka, candidates}` — a shortlist `domain/dupeMatch.ts`
   already computed locally. Do not "improve" this by sending the whole library; keeping the
   user's collection on the device is the design, not an accident.
3. `firebaseIdentifyBottles(images) → IdentifiedBottle[]` — `VISION_PROMPT` + `BOTTLES_SCHEMA`
   with `inlineData` image parts, through `dedupeBottles(json.bottles)`. Photos are already
   downscaled by `import/image.ts`; a transport should not re-encode them.
4. `firebaseReconcileBottles(inputs) → ReconcileMatch[]` — `RECONCILE_PROMPT` +
   `RECONCILE_SCHEMA`, through `parseReconcile(json, inputs)`. The shelf-scan twin of (2), and
   **must not throw** for the same reason: `domain/bottleMatch.ts` already has a local verdict
   for every detection, so a failure costs accuracy, not the scan. Its payload is only the
   detected names plus the few candidate labels that same local pass shortlisted — same rule,
   don't send the inventory.

### Lazy boot (why `useAuth` looks the way it does)

Booting Firebase means downloading the SDK chunk *and* running App Check's reCAPTCHA
handshake. `BarScreen` calls `useAuth`, and My Bar is a primary tab — so subscribing on mount
charged that to every user of an offline-first app, including everyone who never opens an AI
feature. `useAuth` instead arms its subscription only when `cocktail.signedIn` is set (someone
signed in on this browser before) or when the user clicks sign in. The hint is cleared whenever
Firebase resolves to a null user, so a revoked session stops costing anything on the next cold
start. `scripts/smoke.mjs` asserts the chunk is never requested for a signed-out user.

## Firebase console setup (one-time, manual)

Do this in the [Firebase console](https://console.firebase.google.com/) — the project is
**`cocktails-c2705`**, the same one that serves Hosting.

1. Keep the project on the **Spark (free)** plan — do **not** link a billing account.
2. **Authentication →** enable the **Google** sign-in provider. Under **Settings → Authorized
   domains**, confirm `localhost`, `cocktails-c2705.web.app` and `cocktails-c2705.firebaseapp.com`
   are listed (Hosting adds the last two for you).
3. **Firebase AI Logic →** enable it and choose the **Gemini Developer API** provider (the
   free-tier path; the Vertex AI provider requires the Blaze plan).
4. **App Check →** register the web app with **reCAPTCHA v3** and turn on **enforcement** for
   AI Logic. Domains are bare hostnames, no scheme or port:
   `cocktails-c2705.web.app`, `cocktails-c2705.firebaseapp.com`, `localhost`.
5. **(Optional) Per-user rate limit →** in the Google Cloud console, open the Firebase AI Logic
   API's **Quotas** tab and lower the per-user RPM to fit expected usage.
6. **(Optional) Analytics →** enable Google Analytics on the project and copy the
   measurement ID (`G-…`) into `VITE_FIREBASE_MEASUREMENT_ID`. This turns on the `ai_call`
   events described under "Measuring usage" below. Leave it unset and the app behaves
   identically, minus the measurement.
7. Set the build variables as GitHub repo **Variables** (not Secrets — this config is
   public): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
   `VITE_RECAPTCHA_SITE_KEY`. `.github/workflows/deploy.yml` already passes them through. For
   local dev, put the same values in a `.env.local`.

## Measuring usage

`src/auth/analytics.ts` logs one `ai_call` event per call that actually reached the model,
with three params and nothing else: `kind` (parse / dupes / vision / reconcile), `outcome`
(ok / error) and `results` (recipes parsed, bottles read, verdicts returned).

**Why it exists.** Every question about a free allowance or a price — how many imports a
month is generous, what Pro should cost, whether AI can stay unmetered — is a guess until
we know what a real user actually consumes. GA4 aggregates events per user per period for
free on Spark, so this answers it without a backend, a billing account, or committing to
any tier structure.

`results` is there because an allowance priced per *call* would treat a parse yielding four
recipes the same as one yielding one. Knowing the yield distribution is what makes a limit
defensible rather than arbitrary.

Three rules the file has to keep, all enforced by `analytics.test.ts`:

- **It never boots Firebase.** It reaches for `getApp()` — the app a prior AI call already
  initialized — and gives up if there isn't one. `useAuth`'s lazy-boot contract and the
  signed-out assertion in `scripts/smoke.mjs` both depend on this.
- **It never throws or blocks.** Fire-and-forget behind a swallowed catch; a measurement
  failure must not become a failed import.
- **It never logs content.** No recipe names, no bottle names, no pasted text, no photos.
  Counts and enums only — the library staying on the device has no exceptions, and a
  metrics pipeline is not one.

No `setUserId`: GA4's device-scoped pseudo ID is enough for a per-user distribution and
avoids linking measurement to a stable account identifier for no analytical gain.

Unset `VITE_FIREBASE_MEASUREMENT_ID` and the whole thing no-ops.

## Risks / notes

- **Vendor lock-in** to Firebase/Google — acceptable given Gemini is the backend regardless.
- **Free-tier ceilings:** the Gemini Developer API free tier has project-wide limits; sustained
  or heavy use could require upgrading to Blaze. Fine for a hobby app; worth watching.
- **AI does not work on PR preview channels.** Preview URLs look like
  `cocktails-c2705--pr-12-a1b2c3d4.web.app` — a *sibling* of the live domain, not a subdomain,
  so neither Auth's authorized-domain list (no wildcards) nor the reCAPTCHA key covers them.
  Accepted deliberately: previews are for trying UI on a phone, and everything except sign-in
  works there. Don't debug this as a bug.
- **Dev needs an App Check debug token.** `src/auth/firebase.ts` sets
  `FIREBASE_APPCHECK_DEBUG_TOKEN` in DEV, which prints a token to the console on first run;
  paste it into **App Check → Apps → Manage debug tokens** or localhost calls will 403. It is
  per-browser, so each machine registers its own.
- **No hard daily per-user cap** until the optional Functions/Firestore metering layer is added.

## Verification

- Sign in with Google → Import and Shelf scan work; sign out → both are gated with a sign-in
  prompt, and every other screen still works offline.
- `grep` the production `dist/` for **`generativelanguage.googleapis.com`** → must be absent,
  proving nothing calls Gemini directly any more. (The memo used to say "grep for a Gemini key
  pattern". That check is now **wrong and will fail**: `VITE_FIREBASE_API_KEY` is itself an
  `AIza…` string, and it ships on purpose. The endpoint is the honest signal.)
- Confirm the SW precache manifest in `dist/sw.js` does **not** list `assets/firebase-*.js`.
- Confirm App Check enforcement is on and a call from an unregistered origin fails.
- `node scripts/smoke.mjs` — covers the signed-out half end to end.

## Sources

- Firebase AI Logic (get started, web): https://firebase.google.com/docs/ai-logic/get-started
- Firebase AI Logic pricing / Spark free tier: https://firebase.google.com/docs/ai-logic/pricing
- Firebase AI Logic rate limits & quotas (per-user RPM): https://firebase.google.com/docs/ai-logic/quotas
- Firebase Auth — Google sign-in (web): https://firebase.google.com/docs/auth/web/google-signin
- Authorized domains: https://support.google.com/firebase/answer/6400741
- Securing AI endpoints from abuse (App Check): https://firebase.blog/posts/2025/11/securing-ai-endpoints-from-abuse/
