import { useCallback, useEffect, useState } from 'react'
import type { User } from 'firebase/auth'
import { FEATURES, isCloudAIConfigured } from '../config'
import { signInWithGoogle, signOutUser, subscribeAuth } from '../auth/firebase'

export interface AuthState {
  /** The signed-in Google user, or null when logged out. */
  user: User | null
  /** False until the initial auth state has resolved (or Firebase isn't configured). */
  ready: boolean
  /** True when cloud AI is switched on AND a Firebase project is wired up. */
  configured: boolean
  /** The single gate for AI features: configured AND signed in. */
  aiAvailable: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
}

/**
 * Optional Google sign-in state for the cloud-AI features. The app works fully
 * logged-out; only Smart parse and Shelf scan require `aiAvailable`. When the
 * deployment has no Firebase project configured, this stays inert (no SDK load).
 */
export function useAuth(): AuthState {
  const configured = FEATURES.cloudAI && isCloudAIConfigured()
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(!configured)

  useEffect(() => {
    if (!configured) return
    const unsub = subscribeAuth((u) => {
      setUser(u)
      setReady(true)
    })
    return unsub
  }, [configured])

  const signIn = useCallback(async () => {
    await signInWithGoogle()
  }, [])
  const signOut = useCallback(async () => {
    await signOutUser()
  }, [])

  return { user, ready, configured, aiAvailable: configured && !!user, signIn, signOut }
}
