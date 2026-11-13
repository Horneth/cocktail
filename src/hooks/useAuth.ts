import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from 'firebase/auth'
import { FEATURES, isCloudAIConfigured } from '../config'
import {
  clearRedirectPending,
  consumeRedirectResult,
  isRedirectPending,
  needsRedirectSignIn,
  signInWithGoogle,
  signOutUser,
  subscribeAuth,
} from '../auth/firebase'
import { debugLog, describeError } from '../debugLog'

export interface AuthState {
  /** The signed-in Google user, or null when logged out. */
  user: User | null
  /** False while we're still restoring a previous session. */
  ready: boolean
  /** True when cloud AI is switched on AND a Firebase project is wired up. */
  configured: boolean
  /** The single gate for AI features: configured AND signed in. */
  aiAvailable: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

// Remembers "this browser has signed in before". Not a credential and not a
// security boundary — Firebase still owns the real session — just a hint that
// tells us whether booting the SDK is worth it. See `armed` below.
const SIGNED_IN_HINT = 'cocktail.signedIn'

/**
 * Optional Google sign-in state for the cloud-AI features. Recipe import and
 * Shelf scan are the only things that require `aiAvailable`; every other screen
 * works logged out and offline. When the deployment has no Firebase project
 * configured, this stays inert (no SDK load).
 */
export function useAuth(): AuthState {
  const configured = FEATURES.cloudAI && isCloudAIConfigured()

  // True on the page that *started* a redirect, for this page load only. A
  // fresh load (the return page) starts false. It is what stops the outgoing
  // page's inevitable `onAuthStateChanged(null)` from being mistaken for a
  // settled failure and wiping the state the return page needs.
  const redirectInFlight = useRef(false)

  // Subscribing boots Firebase: a few hundred KB of SDK plus App Check's
  // reCAPTCHA handshake. `BarScreen` calls this hook on a primary tab, so
  // subscribing on mount would charge that to every user of an offline-first
  // app — including the majority who never touch AI. So we only arm the
  // subscription for someone who has signed in before (restore their session),
  // someone returning from a redirect sign-in, or someone who just clicked
  // sign in.
  const [armed, setArmed] = useState(
    () =>
      configured &&
      (localStorage.getItem(SIGNED_IN_HINT) === '1' || isRedirectPending()),
  )
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(!armed)

  // One line per mount so the Diagnostics panel shows which screens were live
  // and whether the hook was armed at the time. Cheap, and it dates the run.
  useEffect(() => {
    debugLog('auth', 'useAuth mounted', {
      configured,
      armed,
      hint: localStorage.getItem(SIGNED_IN_HINT),
      href: typeof location !== 'undefined' ? location.href : undefined,
    })
  }, [configured, armed])

  useEffect(() => {
    if (!armed) return
    let cancelled = false
    // If we're arriving back from a redirect sign-in, its result has to be
    // consumed before the SDK will report the user. Harmless on an ordinary
    // boot: with no redirect pending it resolves to null immediately.
    //
    // Guarded by `redirectInFlight`: on the *outgoing* page this also runs and
    // resolves to null (nothing has happened yet), which must not be treated as
    // a settled failure.
    void consumeRedirectResult().then((u) => {
      if (cancelled || redirectInFlight.current) return
      if (u) localStorage.setItem(SIGNED_IN_HINT, '1')
      else localStorage.removeItem(SIGNED_IN_HINT)
      clearRedirectPending()
    })
    return subscribeAuth((u) => {
      debugLog('auth', 'onAuthStateChanged', u ? { email: u.email, uid: u.uid } : 'null')
      setUser(u)
      setReady(true)
      if (u) {
        localStorage.setItem(SIGNED_IN_HINT, '1')
        clearRedirectPending()
      } else if (!redirectInFlight.current) {
        // Keep the hint honest: a session that was revoked or expired resolves
        // to null here, so the next cold start is back to not loading the SDK.
        // But NOT while a redirect is in flight — that null is just "not signed
        // in yet", and clearing here is the bug that broke mobile sign-in.
        localStorage.removeItem(SIGNED_IN_HINT)
        clearRedirectPending()
      }
    })
  }, [armed])

  const signIn = useCallback(async () => {
    debugLog('auth', 'signIn() called from the UI')
    // Arm first: on a screen that never subscribed, nothing would observe the
    // resulting user and the button would appear to do nothing.
    setArmed(true)
    // A redirect sign-in navigates away before it resolves, so arm this browser
    // for the *next* boot too — otherwise the page we come back to has no hint,
    // never subscribes, and the restored session goes unobserved.
    const redirect = needsRedirectSignIn()
    if (redirect) {
      // Belt and braces: the flag that actually matters is set inside
      // signInWithGoogle just before it navigates (see `isRedirectPending`), so
      // the return page arms even though the outgoing page's null auth event no
      // longer clears anything.
      redirectInFlight.current = true
      localStorage.setItem(SIGNED_IN_HINT, '1')
    }
    debugLog('auth', `signIn(): ${redirect ? 'redirect' : 'popup'} flow, redirect armed`)
    try {
      await signInWithGoogle()
    } catch (err) {
      // Never navigated, so nothing is pending after all.
      redirectInFlight.current = false
      clearRedirectPending()
      debugLog('auth', 'signIn() rejected', describeError(err))
      throw err
    }
  }, [])
  const signOut = useCallback(async () => {
    debugLog('auth', 'signOut() called from the UI')
    localStorage.removeItem(SIGNED_IN_HINT)
    await signOutUser()
  }, [])

  return { user, ready, configured, aiAvailable: configured && !!user, signIn, signOut }
}
