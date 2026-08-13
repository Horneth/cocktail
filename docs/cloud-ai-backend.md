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
- **`src/import/cloudAI.ts`** is the transport. It calls four Cloud Functions callables
  (`aiParse`, `aiJudgeDuplicates`, `aiIdentifyBottles`, `aiReconcileBottles`) through
  `callAi()` in `src/auth/firebase.ts`. It supersedes `firebaseAI.ts`, which called Gemini
  from the browser — see "The proxy" below for why that had to change. Same four
  signatures, same contracts, same mappers.
- **Shelf scan is two calls, not one** (see CLAUDE.md, "Photo → bar"): vision, then a
  tiny text-only `firebaseReconcileBottles` that rules same/variant/new on bottles the
  user might already own. Its payload is picked on-device by `domain/bottleMatch.ts` and
  carries only the detected names plus a handful of candidate labels — the inventory
  never leaves the browser — and the call is skipped entirely when nothing is close, so
  a first scan into an empty bar costs exactly one request. It is also non-blocking:
  a failure degrades to the local verdicts rather than breaking the scan.
- **`src/auth/firebase.ts`** initializes the app + App Check + Auth + Functions once, all
  behind dynamic `import()`s, and exposes `signInWithGoogle()` / `signOutUser()` /
  `callAi()`. The Firebase config values (`apiKey`, `projectId`, `appId`, …) are **public
  client config, not secrets**. The real Gemini key lives in Secret Manager and never ships.
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

## The proxy (`functions/`)

The browser used to call Gemini directly, with App Check as the only thing in front of it.
That was fine while inference was free and stopped being fine the moment a paid tier was on
the table, for a reason worth stating plainly: **Firebase AI Logic enforces App Check, not
Auth.** Any page load mints an App Check token, so `useAuth().aiAvailable` was only ever a
*product* gate living in our own UI — never a cost boundary. The leaked resource wasn't a
feature, it was an unattributable Gemini bill.

So the four calls moved behind `onCall` callables in `functions/`, which put four things in
front of the model that a client cannot be trusted to do for itself: App Check, an
authenticated user, payload caps, and a metered counter.

**The split: the callable returns raw model JSON; the client still runs the mappers.**
`functions/` imports only the prompts and schemas from `aiShared.ts`; `finishParse`,
`dedupeBottles` and `parseReconcile` stay in the browser. They encode product vocabulary from
`domain/vocab.ts` that changes far more often than the prompts do, and nobody wants a
Functions deploy in the loop for a tag rename.

**There is no copy of the prompts.** `functions/tsconfig.json` sets `rootDir: ".."` and lists
`../src/import/aiShared.ts` as an entry point, so the real file compiles into `functions/lib`.
This repo has already been burned by three copies of one vocabulary disagreeing; don't
reintroduce that with a "shared" directory that is really a duplicate.

### The four calls

Same four entry points, now in `functions/src/ai.ts` and wrapped by `src/import/cloudAI.ts`.
The symmetry still holds: import and shelf scan are each a *heavy* first call followed by an
*optional, must-not-throw* second call whose payload a local pass already shortlisted.

1. `aiParse` / `cloudParse(text) -> StructuredImport[]` — `PROMPT` + `RESPONSE_SCHEMA`,
   through `finishParse(json, text)`. Beyond the recipes it yields preview-only `guessed` and
   `aka`. **Metered** as one import unit.
2. `aiJudgeDuplicates` / `cloudJudgeDuplicates(queries) -> DupeVerdict[]` — `DUPE_PROMPT` +
   `DUPE_SCHEMA`, through `finishDupeJudgement(json, queries)`. **Must not throw**: the import
   screen fires it after the preview is already on screen, and an error means "no badges", not
   a failed import. The payload is only `{index, name, aka, candidates}` — a shortlist
   `domain/dupeMatch.ts` already computed locally, re-projected server-side so a caller can't
   smuggle extra fields into the prompt. Do not "improve" this by sending the whole library;
   keeping the user's collection on the device is the design, not an accident. **Not metered**
   — it is bundled into the import the user actually asked for, and charging for a check that
   exists to be helpful would mean punishing people for a feature they never requested.
3. `aiIdentifyBottles` / `cloudIdentifyBottles(images) -> IdentifiedBottle[]` —
   `VISION_PROMPT` + `BOTTLES_SCHEMA` with `inlineData` parts, through
   `dedupeBottles(json.bottles)`. Photos are already downscaled by `import/image.ts`; nothing
   re-encodes them. The client sends `{mimeType, data}` rather than data URLs, which is what
   keeps DOM-dependent `image.ts` out of the Functions build. **Metered** as one scan unit —
   the expensive call in the app.
4. `aiReconcileBottles` / `cloudReconcileBottles(inputs) -> ReconcileMatch[]` —
   `RECONCILE_PROMPT` + `RECONCILE_SCHEMA`, through `parseReconcile(json, inputs)`. The
   shelf-scan twin of (2), **must not throw** for the same reason — `domain/bottleMatch.ts`
   already has a local verdict for every detection, so a failure costs accuracy, not the scan
   — and **not metered** for the same reason. Payload is the detected names plus the few
   candidate labels that local pass shortlisted; same rule, don't send the inventory.

Plus `getAccountStatus`, a cold-start read of tier and counters. It exists so the client never
needs the Firestore SDK: adding it would put a few hundred KB back into a bundle we are busy
shrinking, break the signed-out "no Firebase chunk" assertion in `scripts/smoke.mjs`, and stop
"the app has no cloud copy of your library" from being literally true.

### Metering (`functions/src/usage.ts`)

Phase 1 deliberately **observes**. Every AI call is counted; nothing is refused for exceeding
a tier's allowance, because the allowance and the price should come from real usage rather
than a guess. The only thing that fails closed is an abuse ceiling (300 parse / 100 scan per
user per month) — a number no human reaches and a script reaches in minutes.

- `usage/{uid}` holds lifetime counters; `usage/{uid}/months/{YYYY-MM}` holds the month.
  Lifetime is what a future one-time trial reads; monthly is fair-use on the paid tier. Month
  keys are **UTC**, so flying west does not buy a reset.
- `entitlements/{uid}` holds the tier. Read from Firestore, **not** from a custom claim:
  claims go stale, a refund does not invalidate an already-minted ID token, and asking the
  client to refresh its own token is not enforcement. The hot path already opens a transaction
  for the counter, so the read is nearly free.
- `config/ai` is the server-side kill switch (`FEATURES.cloudAI` is its client twin), cached
  60s so an incident does not need a redeploy but a call does not need a read.
- The counter increments **before** the model call. A crash therefore costs the user a unit —
  the right way round when the alternative is an unmetered retry loop.
- `firestore.rules` denies every client read and write. The app learns its tier from the
  callable responses, never by reading Firestore.

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

1. **Upgrade to the Blaze (pay-as-you-go) plan.** Cloud Functions requires it. Do this
   *together* with the guardrails, not after: a **Cloud Billing budget** with alert
   thresholds, and the `maxInstances: 10` already set on every callable so a runaway loop
   cannot autoscale into a four-figure bill before anyone notices.
2. **Authentication →** enable the **Google** sign-in provider. Under **Settings → Authorized
   domains**, confirm `localhost`, `cocktails-c2705.web.app` and `cocktails-c2705.firebaseapp.com`
   are listed (Hosting adds the last two for you).
3. **Firebase AI Logic →** enable it and choose the **Gemini Developer API** provider (the
   free-tier path; the Vertex AI provider requires the Blaze plan).
4. **App Check →** register the web app with **reCAPTCHA v3** and turn on **enforcement** for
   AI Logic. Domains are bare hostnames, no scheme or port:
   `cocktails-c2705.web.app`, `cocktails-c2705.firebaseapp.com`, `localhost`.
5. **Gemini API key → Secret Manager.** Create a Gemini Developer API key, then
   `firebase functions:secrets:set GEMINI_API_KEY` and paste it. It is read at runtime by the
   callables and never appears in the repo, the bundle, or CI.
6. **Firestore →** create the database (Native mode). `firebase deploy --only firestore:rules`
   ships the deny-all rules. No indexes are needed; the queries are all document reads.
7. **Deploy the functions:** `firebase deploy --only functions`. This is **manual for now** —
   `.github/workflows/deploy.yml` typechecks and tests them but does not deploy, because the
   Hosting service account does not have the Cloud Functions and Secret Manager roles. So a
   client change that depends on a new callable needs the functions deployed *first*.
8. **(Optional) Per-user rate limit →** in the Google Cloud console, open the Gemini API's
   **Quotas** tab and lower the per-user RPM to fit expected usage. Currently set to 20.
9. Set the seven build variables as GitHub repo **Variables** (not Secrets — this config is
   public): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
   `VITE_RECAPTCHA_SITE_KEY`. `.github/workflows/deploy.yml` already passes them through. For
   local dev, put the same values in a `.env.local`.

## Risks / notes

- **Vendor lock-in** to Firebase/Google — acceptable given Gemini is the backend regardless.
- **Cost is now attributable per user**, which is the point of the proxy. Watch the Cloud
  Billing budget and the `usage/` collection rather than guessing.
- **AI does not work on PR preview channels.** Preview URLs look like
  `cocktails-c2705--pr-12-a1b2c3d4.web.app` — a *sibling* of the live domain, not a subdomain,
  so neither Auth's authorized-domain list (no wildcards) nor the reCAPTCHA key covers them.
  Accepted deliberately: previews are for trying UI on a phone, and everything except sign-in
  works there. Don't debug this as a bug.
- **Dev needs an App Check debug token.** `src/auth/firebase.ts` sets
  `FIREBASE_APPCHECK_DEBUG_TOKEN` in DEV, which prints a token to the console on first run;
  paste it into **App Check → Apps → Manage debug tokens** or localhost calls will 403. It is
  per-browser, so each machine registers its own.
- **Metering observes, it does not yet enforce a product allowance.** Only the abuse ceiling
  fails closed. Setting a real free allowance and a price is deliberately deferred until there
  is usage data to set them from.

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
