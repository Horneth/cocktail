# Google sign-in and the auth domain — options

Status: **decided — Option A** (open the app at
`https://cocktails-c2705.firebaseapp.com`, same origin as the default
`authDomain`). The v0.5.0 `authDomain` change was reverted in v0.5.1. This
record is kept so the next person doesn't re-derive it.

## The constraint

`signInWithRedirect` completes by sending the browser back to the app, where
`getRedirectResult()` recovers the credential from the **`authDomain`'s**
storage. Browsers now partition/block cross-site storage, so when `authDomain`
is a *different site* from the app, that read returns nothing: the sign-in
finishes with no user, no error, and `getRedirectResult()` resolves to `null`.
The Firebase JS SDK maintainers confirm this directly — firebase/firebase-js-sdk
issue **#7824**, *"Using `signInWithRedirect` with an `authDomain` different than
the domain of the app does not complete the sign in (and reports no errors)"*:

> "staging.com is the authDomain, so it is cross origin compared to
> www.randomUrl123.com. This means login cannot succeed because
> www.randomUrl123.com will try to read session storage of www.staging.com,
> which is disallowed."

So the rule is: **the app and the `authDomain` must be the same site.** The
popup flow is affected the same way on browsers that block third-party storage;
Firebase positions popup as the *workaround*, and it is why desktop Chrome still
worked (looser storage).

Our app is on `cocktails-c2705.web.app`; the default `authDomain` is
`cocktails-c2705.firebaseapp.com` — a different site. That mismatch is the whole
bug.

## Evidence from this session

| Version | Change | Result on Android Chrome |
| --- | --- | --- |
| 0.1.0 | popup only | opens Google, returns, not signed in |
| 0.2.0 | redirect on mobile | same: returns, not signed in |
| 0.3.0 | diagnostics added | `getRedirectResult → {user:null}`, **no error** |
| 0.4.0 | don't clear flag mid-redirect | return page now arms and consumes; still `{user:null}` |
| 0.5.0 | `authDomain` forced to `web.app` | **router 404** after sign-in |

v0.5.0's 404 is informative: it shows Firebase Hosting on **`*.web.app` does
**not** serve the `/__/auth/*` helper, so naming our origin as `authDomain` just
points the SDK at a path our SPA catch-all answers with `index.html`. (My
assumption that Hosting serves the helper on `web.app` was wrong — it came from a
third-party write-up, not the official docs. Note: the official Firebase doc was
blocked by the sandbox and should be re-read before acting — see below.)

## Options

### A. Reach the app at `cocktails-c2705.firebaseapp.com`
The project is served on **both** `<project>.web.app` and
`<project>.firebaseapp.com`. If the app is *opened at* `firebaseapp.com`, then the
default `authDomain` (`…firebaseapp.com`) is the **same origin** as the app, and
the flow is same-site. No proxy, no code cleverness.

- **Pros:** zero functional risk; uses Firebase's default, documented setup;
  works for both popup and redirect; no extra infrastructure; instantly testable.
- **Cons:** changes the canonical URL users should use/install; the installed
  PWA and any shared links currently use `web.app`; two domains serve the same
  build, so we'd want a redirect or a clear "this is the URL".
- **Effort:** ~none in code. Decide the canonical URL; update links/README; maybe
  redirect `web.app` → `firebaseapp.com`.

### B. Keep `web.app`, reverse-proxy `/__/auth/**` on our own domain
Serve the helper at `https://cocktails-c2705.web.app/__/auth/**` by proxying to
`https://cocktails-c2705.firebaseapp.com/__/auth/**`, and set
`authDomain = web.app` (a genuine rewrite, not a 302).

- **Pros:** keeps the `web.app` URL.
- **Cons:** the v0.5.0 404 strongly suggests Hosting doesn't do this out of the
  box, and Firebase Hosting rewrites may not support **external** destinations at
  all — this needs verifying against the Hosting docs (blocked from the sandbox).
  Also requires adding `https://cocktails-c2705.web.app/__/auth/handler` to the
  OAuth client's **authorised redirect URIs** in the Google/Firebase console.
- **Effort:** medium; **risk:** medium–high; depends on unverified Hosting
  behaviour.

### C. Keep `authDomain = firebaseapp.com`, use *popup* on mobile
Don't fight the cross-site storage: use popup everywhere (add
`Cross-Origin-Opener-Policy: same-origin-allow-popups` header), since popup
hands the result back via `postMessage` rather than a cross-site storage read.

- **Pros:** no domain changes; documented workaround.
- **Cons:** contradicts our v0.1.0 observation that popup also failed on the
  user's phone (possibly for a different reason — worth re-testing); popups are
  unreliable/blocked in an installed PWA ("Add to Home Screen"), which is a core
  install target.
- **Effort:** small; **risk:** medium (PWA case).

### D. Put the app on a custom domain under Firebase Hosting
e.g. `cocktails.example.com`, used as both the app origin and `authDomain`; add a
Hosting subdomain for the helper if needed.

- **Pros:** clean, same-site, keeps a nice URL; the SDK maintainer's own
  suggestion (subdomains of one registrable domain share a site).
- **Cons:** needs a domain + DNS + OAuth authorised redirect URI; more moving
  parts.
- **Effort:** medium; **risk:** low once set up.

### E. Proxy via Cloud Functions / Cloud Run
Implement the reverse proxy as server code rather than Hosting rewrites.

- **Pros:** full control, definitely same-origin.
- **Cons:** new deployable, cold starts, more to maintain — heavy for this app.
- **Effort:** high; **risk:** low.

## Recommendation

**Option A**, as the immediate fix and probably the long-term one: it is exactly
the same-site property we need, with no code risk, and it is the user's own
instinct. Everything else is more machinery for the same result. Option D is the
upgrade path if a branded URL is wanted later.

Whatever we choose, **v0.5.0 should be reverted first** to get back to the v0.4.0
behaviour (silent failure, no 404) while we decide.

## Open questions for the decision

1. Is it acceptable to make `https://cocktails-c2705.firebaseapp.com` the URL
   people open and install? (If yes → Option A, little else to do.)
2. If we must keep `web.app`, is a custom domain (Option D) acceptable, or do we
   want to attempt the proxy (Option B) despite the uncertainty?
3. Should we re-check the official Firebase "Redirect best practices" doc (it was
   blocked in the sandbox) before committing to B or D?

## Current state

- **v0.5.1** reverts v0.5.0; `authDomain` is back to `VITE_FIREBASE_AUTH_DOMAIN`
  (`…firebaseapp.com`). On the `web.app` URL, redirect sign-in still completes
  with no user (the original bug); on the `firebaseapp.com` URL it is same-origin
  and works (Option A, chosen).
- Still open if we ever want the `web.app` URL to be the canonical one: Option B
  or D above. Re-read the official Firebase "Redirect best practices" doc before
  attempting either — it was blocked from the sandbox (HTTP 403) and my prior
  claim about Hosting serving `/__/auth/*` on `web.app` was wrong.

## Process note

A sandbox-blocked URL should be surfaced to the user, not routed around. The
blocked URL in question: `https://firebase.google.com/docs/auth/web/redirect-best-practices` (HTTP 403).
