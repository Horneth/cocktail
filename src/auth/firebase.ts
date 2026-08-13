import type { Auth, User } from 'firebase/auth'
import type { Functions } from 'firebase/functions'
import { firebaseConfig, functionsEmulator, isCloudAIConfigured, recaptchaSiteKey } from '../config'

// Firebase bootstrap for the optional cloud-AI features. Everything here is
// lazy: the (large) Firebase SDK is only imported when this runs, so browsing
// the app offline never pays for it. This file handles Google sign-in and
// invoking the AI callables — the model, its prompts and the Gemini key all
// live in Cloud Functions, so none of them ship in this bundle.

interface FirebaseHandles {
  auth: Auth
  functions: Functions
}

let handles: Promise<FirebaseHandles> | null = null

/** Initialize (once) the Firebase app, App Check, Auth, and AI Logic. */
function ensureFirebase(): Promise<FirebaseHandles> {
  if (!isCloudAIConfigured()) {
    return Promise.reject(new Error('Cloud AI is not configured for this deployment.'))
  }
  if (!handles) {
    handles = (async () => {
      const [{ initializeApp }, { getAuth }, { getFunctions }] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/functions'),
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
      const functions = getFunctions(app)

      // Point at the local emulator when one is running, so `npm run dev`
      // against `firebase emulators:start` never spends real inference.
      if (functionsEmulator) {
        const { connectFunctionsEmulator } = await import('firebase/functions')
        const [host, port] = functionsEmulator.split(':')
        connectFunctionsEmulator(functions, host || 'localhost', Number(port) || 5001)
      }

      return { auth, functions }
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
 * Invoke one of the AI callables. The App Check token and the user's ID token
 * ride along automatically, which is what lets the function refuse anonymous or
 * unattested traffic — the browser is no longer trusted to gate anything.
 */
export async function callAi(name: string, data: unknown): Promise<unknown> {
  const { functions } = await ensureFirebase()
  const { httpsCallable } = await import('firebase/functions')
  const result = await httpsCallable(functions, name)(data)
  return result.data
}
