# Cloud AI as a first-class backend — decision & setup

_Status: decision record + setup guide. Written 2026-07._

## Why change the current model

Today cloud AI is **bring-your-own-key**: each user pastes a Gemini API key into
`localStorage` (`cocktail.geminiKey`) and the browser calls Google directly
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
backend**: Google runs the proxy, the Gemini key stays server-side, and it works from the
existing GitHub Pages hosting.

- **Firebase AI Logic** (GA, JS/web SDK) — the client calls Gemini through Google's proxy, so
  there's **no API key in client code and no server for us to write**. Uses the **Gemini
  Developer API** provider on the **free Spark plan** (no Cloud Billing account). It supports
  the same `responseSchema` / `responseMimeType: 'application/json'` structured output we
  already rely on, so our schemas and prompts carry over unchanged.
- **Firebase Authentication** — Google sign-in (popup or redirect). Free, and works from any
  origin as long as the domain is on the **Authorized domains** list. No migration off GitHub
  Pages.
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

## What changes in the app

- **Deps:** add `firebase` (modular imports: `firebase/app`, `firebase/auth`, `firebase/ai`,
  `firebase/app-check`); lazy-load the AI/auth modules so the core bundle stays lean.
- **Transport swap in `src/import/gemini.ts`:** replace the raw `fetch` to
  `generativelanguage.googleapis.com` with the Firebase AI Logic SDK —
  `getAI()` → `getGenerativeModel({ model, generationConfig: { responseMimeType, responseSchema } })`
  → `generateContent(parts)`. `geminiParse` / `geminiIdentifyBottles` **drop the `apiKey`
  argument**; everything downstream (mappers, schemas, prompts) is unchanged. Vision still sends
  `inlineData` parts via `splitDataUrl` (`src/import/image.ts`).
- **New `src/auth/firebase.ts`:** initialize the Firebase app + App Check + Auth once; expose
  `signInWithGoogle()`, `signOut()`, and an auth-state hook. The Firebase config values
  (`apiKey`, `projectId`, `appId`, …) are **public client config, not secrets** — safe to
  commit. (The real, secret Gemini key lives in the Firebase project and never ships.)
- **`src/hooks/useSettings.ts`:** retire the BYO-key storage; gating moves from
  `gemini.hasKey` to `isSignedIn`.
- **`src/config.ts`:** `FEATURES.cloudAI` stays the kill switch; add the Firebase config object.
- **UI:** AI entry points in `ImportScreen`/`BarScreen` show **"Sign in with Google to use AI"**
  when logged out (replacing the "set your key" nudge); `SettingsScreen` gains sign-in/sign-out
  and account display instead of the key field. Logged-out users still get the offline
  `parseRecipeText` path.

## Firebase console setup (one-time, manual)

Do this in the [Firebase console](https://console.firebase.google.com/) before the code can run:

1. **Create a project** (or reuse one). Keep it on the **Spark (free)** plan — do **not** link a
   billing account.
2. **Authentication →** enable the **Google** sign-in provider. Under **Settings → Authorized
   domains**, add the app's origins: `localhost`, the `*.github.io` Pages origin, and any custom
   domain.
3. **Firebase AI Logic →** enable it and choose the **Gemini Developer API** provider (the
   free-tier path; the Vertex AI provider requires the Blaze plan).
4. **App Check →** register the web app with **reCAPTCHA v3**; create a site key for each origin
   above, and turn on **enforcement** for AI Logic.
5. **(Optional) Per-user rate limit →** in the Google Cloud console, open the Firebase AI Logic
   API's **Quotas** tab and lower the per-user RPM to fit expected usage.
6. Copy the web app's Firebase config into `src/config.ts` (public values).

## Risks / notes

- **Vendor lock-in** to Firebase/Google — acceptable given Gemini is the backend regardless.
- **Free-tier ceilings:** the Gemini Developer API free tier has project-wide limits; sustained
  or heavy use could require upgrading to Blaze. Fine for a hobby app; worth watching.
- **App Check per domain:** the reCAPTCHA v3 site key must be registered for every origin
  (`localhost`, `github.io`, custom domain) or calls will 403.
- **No hard daily per-user cap** until the optional Functions/Firestore metering layer is added.

## Verification

- Sign in with Google → Smart parse and Shelf scan work; sign out → AI is gated with a sign-in
  prompt while the offline basic parser still works.
- `grep` the production `dist/` bundle for any Gemini key pattern → must be **absent** (proves
  no key ships).
- Confirm App Check enforcement is on and a call from an unregistered origin fails.

## Sources

- Firebase AI Logic (get started, web): https://firebase.google.com/docs/ai-logic/get-started
- Firebase AI Logic pricing / Spark free tier: https://firebase.google.com/docs/ai-logic/pricing
- Firebase AI Logic rate limits & quotas (per-user RPM): https://firebase.google.com/docs/ai-logic/quotas
- Firebase Auth — Google sign-in (web): https://firebase.google.com/docs/auth/web/google-signin
- Authorized domains: https://support.google.com/firebase/answer/6400741
- Securing AI endpoints from abuse (App Check): https://firebase.blog/posts/2025/11/securing-ai-endpoints-from-abuse/
