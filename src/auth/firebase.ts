import type { Auth, User } from 'firebase/auth'
import type { AI, TemplateGenerativeModel } from 'firebase/ai'
import type { FirebaseApp } from 'firebase/app'
import { firebaseConfig, isCloudAIConfigured, recaptchaSiteKey } from '../config'
import { debugLog, describeError } from '../debugLog'

// Firebase bootstrap for the optional cloud-AI features. Everything here is
// lazy: the (large) Firebase SDK is only imported when this runs, so browsing
// the app offline never pays for it. The Gemini key stays in the Firebase
// project — this file only handles Google sign-in and getting a model handle.

interface FirebaseHandles {
  app: FirebaseApp
  auth: Auth
  ai: AI
}

let handles: Promise<FirebaseHandles> | null = null

/** Initialize (once) the Firebase app, App Check, Auth, and AI Logic. */
function ensureFirebase(): Promise<FirebaseHandles> {
  if (!isCloudAIConfigured()) {
    return Promise.reject(new Error('Cloud AI is not configured for this deployment.'))
  }
  if (!handles) {
    debugLog('auth', 'initializing Firebase SDK', {
      projectId: firebaseConfig.projectId,
      authDomain: firebaseConfig.authDomain,
    })
    handles = (async () => {
      try {
        const [{ initializeApp }, { getAuth }, { getAI, GoogleAIBackend }] = await Promise.all([
          import('firebase/app'),
          import('firebase/auth'),
          import('firebase/ai'),
        ])
        const app = initializeApp(firebaseConfig)

        // App Check attests calls come from the real app; it's required to call
        // AI Logic. localhost has no registered reCAPTCHA domain, so we hand the
        // SDK a debug token instead.
        //
        // `true` makes it mint one and log it for you to register. That is fine
        // until you clear site data and have to re-register — so setting
        // VITE_APPCHECK_DEBUG_TOKEN to an already-registered token pins it.
        //
        // Not gated on DEV alone: `npm run preview` serves a production build,
        // which is exactly where you want to check the real bundle before
        // deploying, and DEV is false there. The var is only ever set in
        // .env.local (gitignored) and is deliberately absent from deploy.yml, so
        // a deployed build cannot carry one.
        if (recaptchaSiteKey) {
          const debugToken = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN
          if (debugToken || import.meta.env.DEV) {
            ;(
              globalThis as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }
            ).FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken || true
          }
          const { initializeAppCheck, ReCaptchaV3Provider } = await import('firebase/app-check')
          initializeAppCheck(app, {
            provider: new ReCaptchaV3Provider(recaptchaSiteKey),
            isTokenAutoRefreshEnabled: true,
          })
          debugLog('auth', 'App Check initialized', { debugToken: Boolean(debugToken) })
        } else {
          debugLog('auth', 'App Check SKIPPED (no reCAPTCHA site key)')
        }

        const auth = getAuth(app)
        // Gemini Developer API provider — works on the free Spark plan.
        const ai = getAI(app, { backend: new GoogleAIBackend() })
        debugLog('auth', 'Firebase SDK ready')
        return { app, auth, ai }
      } catch (err) {
        debugLog('auth', 'Firebase SDK init FAILED', describeError(err))
        throw err
      }
    })()
  }
  return handles
}

/** Subscribe to auth changes. Returns an unsubscribe fn (safe to call anytime). */
export function subscribeAuth(cb: (user: User | null) => void): () => void {
  let cancelled = false
  let unsub = () => {}
  debugLog('auth', 'subscribeAuth: booting SDK and subscribing')
  ensureFirebase()
    .then(async ({ auth }) => {
      if (cancelled) return
      const { onAuthStateChanged } = await import('firebase/auth')
      unsub = onAuthStateChanged(auth, cb)
      debugLog('auth', 'subscribeAuth: listening for auth changes')
    })
    .catch((err) => {
      debugLog('auth', 'subscribeAuth: SDK boot FAILED', describeError(err))
      if (!cancelled) cb(null)
    })
  return () => {
    cancelled = true
    unsub()
  }
}

/**
 * Whether sign-in must use a full-page redirect rather than a popup.
 *
 * A popup hands the credential back to the page that opened it through
 * `window.opener`/`postMessage`, and that link is exactly what breaks on
 * phones: mobile Safari (WebKit/ITP) severs it, so the popup finishes Google's
 * flow in a separate browsing context and the tab you came from never hears
 * about it — the user lands back on Settings still signed out, with no error.
 * An installed PWA is worse: `display: standalone` has no opener at all, so a
 * popup can never report the result. Desktop Chrome keeps the link and is fine.
 * Redirect is the flow Firebase recommends here (see docs/cloud-ai-backend.md).
 */
export function needsRedirectSignIn(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ masquerades as "Macintosh", so the UA alone misses it;
  // maxTouchPoints is what separates a real iPad from a desktop Mac.
  const iPadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  const mobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(ua) || iPadOS
  // Any standalone (installed) PWA, including desktop, lacks an opener.
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return mobile || standalone
}

/**
 * Result of a sign-in attempt. `redirecting` means the page is about to navigate
 * away and the credential will arrive on the page we come back to — see
 * `consumeRedirectResult`.
 */
export type SignInOutcome = 'signed-in' | 'redirecting'

/**
 * Marks a redirect sign-in that is currently in flight. Written immediately
 * before `signInWithRedirect` navigates away, read on the page it returns to so
 * that page arms the auth subscription and consumes the result.
 *
 * This has to be separate from the caller's "signed in before" hint. Arming the
 * subscription fires `onAuthStateChanged` with `null` right away (we are not
 * signed in *yet*), and the caller, seeing `null`, would clear its hint before
 * we have even left — so the page that comes back finds no reason to arm and
 * the Google credential is never read. "A redirect is in flight" and "this
 * browser signed in before" are different facts and need different flags.
 *
 * localStorage rather than sessionStorage: it must survive the trip out to
 * `*.firebaseapp.com` and back. Cleared as soon as the redirect settles.
 */
const REDIRECT_PENDING = 'cocktail.authRedirectPending'

/** Whether a redirect sign-in is in flight (set on the outgoing page). */
export function isRedirectPending(): boolean {
  try {
    return localStorage.getItem(REDIRECT_PENDING) === '1'
  } catch {
    return false
  }
}

/** Clear the in-flight marker once a redirect has settled (or was abandoned). */
export function clearRedirectPending(): void {
  try {
    localStorage.removeItem(REDIRECT_PENDING)
  } catch {
    // ignore
  }
}

/**
 * Start a Google sign-in: a popup on desktop, a full-page redirect on mobile or
 * in an installed PWA (where a popup can't return its result). Both paths are
 * observed through the auth subscription; the redirect one additionally needs
 * `consumeRedirectResult` once the browser returns.
 */
/**
 * Fetch the Auth helper on the resolved authDomain and record what comes back,
 * so a single run says whether that origin really serves it. A correctly
 * proxied/hosted helper returns Firebase's own page; if the origin does NOT
 * serve it, the SPA catch-all hands back our index.html and `served` is false —
 * which is exactly the state that makes `getRedirectResult()` return null.
 */
async function probeAuthHelper(host: string): Promise<void> {
  if (!host || typeof location === 'undefined') return
  try {
    const res = await fetch(`https://${host}/__/auth/iframe`, { redirect: 'follow' })
    const body = await res.text()
    // Our index.html is the giveaway: it mounts #root and a hashed bundle.
    const looksLikeSpa = body.includes('id="root"') || /assets\/index-[\w-]+\.js/.test(body)
    debugLog('auth', 'auth helper probe', {
      host,
      status: res.status,
      served: res.ok && !looksLikeSpa,
      bodyStart: body.slice(0, 80),
    })
  } catch (err) {
    debugLog('auth', 'auth helper probe FAILED', describeError(err))
  }
}

export async function signInWithGoogle(): Promise<SignInOutcome> {
  const { auth } = await ensureFirebase()
  const { GoogleAuthProvider } = await import('firebase/auth')
  debugLog('auth', 'signIn: resolved auth config', { authDomain: auth.config.authDomain })
  void probeAuthHelper(auth.config.authDomain ?? '')
  const redirect = needsRedirectSignIn()
  debugLog('auth', `signIn: using ${redirect ? 'redirect' : 'popup'} flow`, {
    redirect,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '(none)',
    displayModeStandalone:
      typeof window !== 'undefined'
        ? window.matchMedia?.('(display-mode: standalone)').matches === true
        : undefined,
    authDomain: firebaseConfig.authDomain,
    href: typeof location !== 'undefined' ? location.href : undefined,
  })

  if (redirect) {
    const { signInWithRedirect } = await import('firebase/auth')
    // Mark BEFORE navigating: the return page reads this to know to arm.
    try {
      localStorage.setItem(REDIRECT_PENDING, '1')
    } catch {
      // Private mode — the sign-in just won't survive the round-trip.
    }
    debugLog('auth', 'signIn: marked a redirect as pending; calling signInWithRedirect')
    try {
      await signInWithRedirect(auth, new GoogleAuthProvider())
      debugLog('auth', 'signIn: signInWithRedirect returned (awaiting navigation)')
      return 'redirecting'
    } catch (err) {
      debugLog('auth', 'signIn: signInWithRedirect FAILED', describeError(err))
      throw err
    }
  }

  const { signInWithPopup } = await import('firebase/auth')
  debugLog('auth', 'signIn: calling signInWithPopup')
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider())
    debugLog('auth', 'signIn: popup resolved', { email: result.user.email })
    return 'signed-in'
  } catch (err) {
    debugLog('auth', 'signIn: signInWithPopup FAILED', describeError(err))
    throw err
  }
}

/**
 * Complete a redirect sign-in, on the page the browser sent us back to. Safe to
 * call on every boot: it resolves to `null` when no redirect was pending.
 *
 * Failures (user denied, redirect cancelled, expired state) are folded into
 * `null` rather than thrown: sign-in is optional, and the auth subscription
 * reports the resulting signed-out state on its own.
 */
export async function consumeRedirectResult(): Promise<User | null> {
  const { auth } = await ensureFirebase()
  const { getRedirectResult } = await import('firebase/auth')
  debugLog('auth', 'consumeRedirectResult: checking for a pending redirect')
  try {
    const result = await getRedirectResult(auth)
    debugLog('auth', 'consumeRedirectResult: done', {
      user: result?.user.email ?? null,
      providerId: result?.user.providerData?.[0]?.providerId ?? null,
    })
    return result?.user ?? null
  } catch (err) {
    // This used to vanish into a bare `catch {}` — which is precisely why a
    // failed redirect looked like "nothing happened". Keep it non-fatal, but
    // record the real code so the Diagnostics panel can show it.
    debugLog('auth', 'consumeRedirectResult: getRedirectResult FAILED', describeError(err))
    return null
  }
}

export async function signOutUser(): Promise<void> {
  const { auth } = await ensureFirebase()
  const { signOut } = await import('firebase/auth')
  debugLog('auth', 'signOut: signing out')
  await signOut(auth)
  debugLog('auth', 'signOut: done')
}

/**
 * Handle for prompts that live in the Firebase project rather than in this
 * bundle. The model, its config and the prompt text all come from the template,
 * so the client supplies only a template id and the variables to fill it with —
 * which is what lets the project refuse any request that isn't one of ours.
 *
 * See `docs/prompt-templates/` for the authored copies of those templates.
 */
export async function getTemplateModel(): Promise<TemplateGenerativeModel> {
  const { ai } = await ensureFirebase()
  const { getTemplateGenerativeModel } = await import('firebase/ai')
  return getTemplateGenerativeModel(ai)
}

/**
 * The initialized app, for transports that aren't AI Logic (the image pool's
 * Cloud Function call goes through firebase/functions on the same app). Same
 * lazy boot, same App Check arming — nothing runs until an AI feature asks.
 */
export async function ensureFirebaseApp(): Promise<FirebaseApp> {
  const { app } = await ensureFirebase()
  return app
}
