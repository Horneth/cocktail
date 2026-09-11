import type { Auth, User } from 'firebase/auth'
import type { AI, TemplateGenerativeModel } from 'firebase/ai'
import type { FirebaseApp } from 'firebase/app'
import { firebaseConfig, isCloudAIConfigured, recaptchaSiteKey } from '../config'

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
    handles = (async () => {
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
      }

      const auth = getAuth(app)
      // Gemini Developer API provider — works on the free Spark plan.
      const ai = getAI(app, { backend: new GoogleAIBackend() })
      return { app, auth, ai }
    })()
  }
  return handles
}

/** Subscribe to auth changes. Returns an unsubscribe fn (safe to call anytime). */
export function subscribeAuth(cb: (user: User | null) => void): () => void {
  let cancelled = false
  let unsub = () => {}
  ensureFirebase()
    .then(async ({ auth }) => {
      if (cancelled) return
      const { onAuthStateChanged } = await import('firebase/auth')
      unsub = onAuthStateChanged(auth, cb)
    })
    .catch(() => {
      if (!cancelled) cb(null)
    })
  return () => {
    cancelled = true
    unsub()
  }
}

/** Open the Google sign-in popup and resolve with the signed-in user. */
export async function signInWithGoogle(): Promise<User> {
  const { auth } = await ensureFirebase()
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth')
  const result = await signInWithPopup(auth, new GoogleAuthProvider())
  return result.user
}

export async function signOutUser(): Promise<void> {
  const { auth } = await ensureFirebase()
  const { signOut } = await import('firebase/auth')
  await signOut(auth)
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
