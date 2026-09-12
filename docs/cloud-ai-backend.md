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
  `StructuredImport`) is unchanged and lives in `src/import/aiShared.ts`. (Since superseded:
  the prompts and schemas named here moved into server prompt templates — see
  `docs/ai-hybrid-and-templates.md` and the list of four calls below.)
- **Shelf scan is two calls, not one** (see CLAUDE.md, "Photo → bar"): vision, then a
  tiny text-only `firebaseReconcileBottles` that rules same/variant/new on bottles the
  user might already own. Its payload is picked on-device by `domain/bottleMatch.ts` and
  carries only the detected names plus a handful of candidate labels — the inventory
  never leaves the browser — and the call is skipped entirely when nothing is close, so
  a first scan into an empty bar costs exactly one request. It is also non-blocking:
  a failure degrades to the local verdicts rather than breaking the scan.
- **`src/auth/firebase.ts`** initializes the app + App Check + Auth once, all behind dynamic
  `import()`s, and exposes `signInWithGoogle()` / `signOutUser()` / `getTemplateModel()`. The
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

A replacement transport needs **all four** entry points in `src/import/firebaseAI.ts`. Each
runs a **server prompt template** — the prompt, model, temperature and output ceiling live in
the Firebase project, authored copies in `docs/prompt-templates/`; the client sends a template
id from `TEMPLATES` plus variables. The mappers that turn the response into our types still
live in `aiShared.ts` and should be reused verbatim. Note the symmetry: import and shelf scan
are each a *heavy* first call followed by an *optional, must-not-throw* second call whose
payload a local pass already shortlisted.

1. `firebaseParse(text) → StructuredImport[]` — `cocktail-parse-v1-0-0`, through
   `finishParse(json, text)`. Beyond the recipes it yields preview-only `guessed` and `aka`.
   Sends the vocabularies from `domain/vocab.ts` as variables, so the console never holds a
   second copy of the one list the pickers also read.
2. `firebaseJudgeDuplicates(queries) → DupeVerdict[]` — `cocktail-dupes-v1-0-0`, through
   `finishDupeJudgement(json, queries)`. **Must not throw**: the import screen fires it after
   the preview is already on screen, and an error means "no badges", not a failed import.
   The payload is only `{index, name, aka, candidates}` — a shortlist `domain/dupeMatch.ts`
   already computed locally. Do not "improve" this by sending the whole library; keeping the
   user's collection on the device is the design, not an accident.
3. `firebaseIdentifyBottles(images) → IdentifiedBottle[]` — `cocktail-vision-v1-0-0`, sending
   photos as `{mimeType, contents}` variables the template renders with `{{media}}`, through
   `dedupeBottles(json.bottles)`. Photos are already downscaled by `import/image.ts`; a
   transport should not re-encode them.
4. `firebaseReconcileBottles(inputs) → ReconcileMatch[]` — `cocktail-reconcile-v1-0-0`,
   through `parseReconcile(json, inputs)`. The shelf-scan twin of (2), and
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

1. **Plan.** The four AI Logic calls (parse / dupes / vision / reconcile) work on the
   **Spark (free)** plan. The **image pool** (below) needs **Blaze**, because 2nd-gen Cloud
   Functions require it and Vertex AI image generation bills per image. If you never deploy
   the function, everything except pool photos works free; if you do, the four AI Logic calls
   keep using the Gemini Developer API free tier exactly as before.
2. **Authentication →** enable the **Google** sign-in provider. Under **Settings → Authorized
   domains**, confirm `localhost`, `cocktails-c2705.web.app` and `cocktails-c2705.firebaseapp.com`
   are listed (Hosting adds the last two for you).
3. **Firebase AI Logic →** enable it and choose the **Gemini Developer API** provider (the
   free-tier path; the Vertex AI provider requires the Blaze plan).
4. **App Check →** register the web app with **reCAPTCHA v3**. Domains are bare hostnames, no
   scheme or port: `cocktails-c2705.web.app`, `cocktails-c2705.firebaseapp.com`, `localhost`.
   Enforcement for AI Logic can go on immediately; enforcement for **Cloud Functions**
   (needed by `generateImage`) is a separate toggle on the same page — start it in
   **Monitoring** if you'd rather watch a few days first, the callable rejects unattested
   requests only once enforcement is on.
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

## The image pool (generateImage Cloud Function)

Recipe photos come from one **generated-image pool** in Firebase Storage,
content-addressed by drink name (`generated/v1/<key>-{thumb,card,full}.webp`).
Everyone who adds the same drink shares one entry, generated once — seeded for
~100 classics by the seeder (`npm run images`, your own AI Studio key, no
function needed: `--review` generates into `tmp/pool-review/` for eyeballing,
`--upload-review` then publishes exactly those files with no further model
calls), and generated on demand for anything else by the **`generateImage`
callable** in `functions/`. The editor auto-attaches a pool shot to every
image-less cocktail a signed-in user saves; a hit is instant and free.

Why a function instead of AI Logic: image generation isn't supported in
template-only mode, and the prompt must never ship to the client. So the
callable composes the prompt itself from `functions/shared/poolPrompt.mjs` —
a verbatim copy of `src/domain/poolPrompt.mjs`, kept identical by a test. The
client sends five recipe fields and receives `{key, cached}`; the callable
enforces, in order:

1. **App Check + auth** (`enforceAppCheck`, uid required).
2. **Strict validation** — every field sanitized + length-capped before any
   prompt is composed.
3. **Pool hit → free return.** A name that already has an image costs nothing.
4. **Curated classics are seeder-only.** Any name in `scripts/classics.json`
   refuses on-demand generation — the first person to add a classic must never
   dictate the pool image everyone else shares. `npm run images` publishes
   their shot; until then the app shows the spirit tile. To re-curate one:
   regenerate it (`npm run images -- --only negroni --force`) and bump
   `POOL_V` in `src/domain/poolKey.mjs` (+ the `functions/shared` copy) so
   cached clients pick up the new file.
5. **Per-user daily rate limit** in **Firestore** (`imageGenUsage/<uid>:<day>`,
   `IMAGE_GEN_DAILY_LIMIT`, default 10), evaluated *before* generation and
   **failing closed** — a quota-check outage disables generation, never the
   limit. Pool hits never touch the counter.
6. **Vertex AI with the function's service account (ADC)** — no API key exists
   anywhere; the project's template-only mode for AI Logic doesn't apply to
   server-side Vertex calls.

### Vertex AI setup for the pool (step by step)

Do these once, in order. The project is `cocktails-c2705`; every console path
below is in the Google Cloud console for that project unless it says Firebase.

1. **Upgrade the project to Blaze** (Firebase console → ⚙ Usage and billing →
   Modify plan → Blaze). 2nd-gen Cloud Functions are built on Cloud Run, which
   requires a billing account even at zero usage. Nothing else in this app
   changes: the AI Logic calls stay on the Gemini Developer API free tier, and
   Storage/Hosting free allowances still apply. Set a budget alert
   (Cloud console → Billing → Budgets, e.g. $5) as a tripwire.

2. **Enable the Vertex AI API.** Console → APIs & Services → Library → search
   "Vertex AI API" → Enable (project `cocktails-c2705`). Equivalent CLI:
   `gcloud services enable aiplatform.googleapis.com --project cocktails-c2705`

3. **Pick the runtime service account and grant it three roles.** By default the
   callable runs as the project's *default compute service account*
   (`<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`, shown in
   console → ⚙ Project settings → Service accounts), which carries Project
   **Editor** — the calls work, but Editor is more than this one function
   needs. Least-privilege alternative:

   ```bash
   # a dedicated runtime account
   gcloud iam service-accounts create image-gen --project cocktails-c2705 \
     --display-name "generateImage runtime"
   SA=image-gen@cocktails-c2705.iam.gserviceaccount.com

   # 1) call the image model
   gcloud projects add-iam-policy-binding cocktails-c2705 \
     --member "serviceAccount:$SA" --role roles/aiplatform.user
   # 2) write pool files to the app bucket (admin SDK Storage)
   gsutil iam ch serviceAccount:$SA:objectAdmin gs://<VITE_FIREBASE_STORAGE_BUCKET>
   # 3) read+write the daily rate counter
   gcloud projects add-iam-policy-binding cocktails-c2705 \
     --member "serviceAccount:$SA" --role roles/datastore.user
   ```

   then point the function at it with the `IMAGE_GEN_SA` env var set to the
   same email — the function's `serviceAccount` option pins it. If you skip
   this step entirely, the default account's Editor covers all three needs;
   you're trading auditability for zero IAM clicking.

4. **Verify the model before deploying.** With your own credentials:

   ```bash
   gcloud auth application-default login   # your account, same roles as step 3 to test
   npm run images:verify                    # scripts/verify-vertex.mjs
   ```

   It fires one real generateContent request and tells you which step is
   missing on failure (API disabled, role missing → 403; wrong model id → 404).
   The default model is `gemini-2.5-flash-image`; change with
   `IMAGE_GEN_MODEL` and re-run the check before deploying. Pass
   `--region <region>` to check model availability in a non-US region.

5. **Create the Firestore database.** Firebase console → Firestore Database →
   Create → **Native mode**, location `us-central1` (same region as the
   function), **locked mode** (the client never touches it — only the admin
   SDK reads/writes `imageGenUsage/<uid>:<day>`). Miss this and generation
   fails closed: users get "try again", never unmetered spend.

6. **Turn on Cloud Functions App Check enforcement** (App Check → Cloud
   Functions → Enforce). The callable also declares `enforceAppCheck: true`,
   so unattested calls are rejected at both layers. Note the earlier preview-
   channel caveat: enforcement rejects calls from PR preview URLs, which is
   accepted — previews never deploy the function anyway.

7. **Deploy.** `npx firebase-tools deploy --only functions,storage` — or just push
   to `main`, the workflow deploys functions + storage rules on the live
   channel only (never PR previews, so unreviewed code can't replace the prod
   callable).

Knobs (all env vars on the function, all optional). The region/SA/limit ones
are also **repo Variables** (GitHub → Settings → Secrets and variables →
Actions) — the deploy workflow copies them into `functions/.env` before
deploying (`IMAGE_FN_REGION`, `VERTEX_REGION`, `IMAGE_GEN_SA`,
`IMAGE_GEN_DAILY_LIMIT`), so changing one takes effect on the next deploy, not
instantly:
`IMAGE_GEN_MODEL` (default `gemini-2.5-flash-image`), `IMAGE_FN_REGION`
(default `us-central1` — where the callable deploys; the client must point at
the same one via `VITE_FIREBASE_FUNCTIONS_REGION`), `VERTEX_REGION` (default
`us-central1` — where the model API is called; must serve
`IMAGE_GEN_MODEL`), `IMAGE_GEN_DAILY_LIMIT`
(default 10 generations/user/day; pool hits never count),
`IMAGE_GEN_SA` (least-privilege runtime account, see step 3).

**Keeping it in Europe.** Nothing forces US regions: create
`functions/.env` with `IMAGE_FN_REGION=europe-west1` and
`VERTEX_REGION=europe-west1`, set
`VITE_FIREBASE_FUNCTIONS_REGION=europe-west1` for the app build, and check
the model actually serves there with `npm run images:verify -- --region
europe-west1` before deploying (if it 404s, try `europe-west3`, `europe-west2`,
`europe-west4` — the script tells you). The Firestore database at `eur3` and a
European bucket need no changes: the admin SDK reaches them from any region,
and the counter is a handful of writes per user per day.

**Cost shape.** Only *misses* bill: ~$0.03–0.04 per generated drink for
flash-image models (three resizes come out of the one generation). The
`imageStatus`/`pending` guard and the Firestore rate limit bound the spend per
user per day; the seeded classics make the common path a $0 pool hit. Storage
for the pool is webp at ~250 KB per drink for all three sizes.

**If you'd rather not enable Vertex at all:** the seeder (`npm run images`)
already fills the pool for classics without it, and you can keep the project
on Spark — signed-in users simply never generate on-demand images (they keep
spirit tiles and uploads). The function only ever adds the long tail.

The client side (`src/import/imageGen.ts`) re-validates input, logs one
`ai_call` event with `kind: 'image'` per call, and derives all URLs itself from
the returned key — the server's answer can't make the app fetch an arbitrary
URL. Signed-out users simply never generate: they keep spirit tiles and any
uploaded photos, and the SW caches pool images after first view.

## Measuring usage

`src/auth/analytics.ts` logs one `ai_call` event per call that actually reached the model,
with three params and nothing else: `kind` (parse / dupes / vision / reconcile / image), `outcome`
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
