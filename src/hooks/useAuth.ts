import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { FEATURES, isCloudAIConfigured } from '../config'
import { signInWithGoogle, signOutUser, subscribeAuth } from '../auth/firebase'

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
 * Optional Google sign-in state for the cloud-AI features. The app works fully
 * logged-out; only Smart parse and Shelf scan require `aiAvailable`. When the
 * deployment has no Firebase project configured, this stays inert (no SDK load).
 */
export function useAuth(): AuthState {
  const configured = FEATURES.cloudAI && isCloudAIConfigured()

  // Subscribing boots Firebase: a few hundred KB of SDK plus App Check's
  // reCAPTCHA handshake. `BarScreen` calls this hook on a primary tab, so
  // subscribing on mount would charge that to every user of an offline-first
  // app — including the majority who never touch AI. So we only arm the
  // subscription for someone who has signed in before (restore their session)
  // or who just clicked sign in.
  const [armed, setArmed] = useState(
    () => configured && localStorage.getItem(SIGNED_IN_HINT) === '1',
  )
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(!armed)

  useEffect(() => {
    if (!armed) return
    return subscribeAuth((u) => {
      setUser(u)
      setReady(true)
      // Keep the hint honest. A session that was revoked or expired resolves to
      // null here, which clears it — so the next cold start is back to not
      // loading the SDK at all.
      if (u) localStorage.setItem(SIGNED_IN_HINT, '1')
      else localStorage.removeItem(SIGNED_IN_HINT)
    })
  }, [armed])

  const signIn = useCallback(async () => {
    // Arm first: on a screen that never subscribed, nothing would observe the
    // resulting user and the button would appear to do nothing.
    setArmed(true)
    await signInWithGoogle()
  }, [])
  const signOut = useCallback(async () => {
    localStorage.removeItem(SIGNED_IN_HINT)
    await signOutUser()
  }, [])

  return { user, ready, configured, aiAvailable: configured && !!user, signIn, signOut }
}
