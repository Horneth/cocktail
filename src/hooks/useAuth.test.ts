import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from 'firebase/auth'

// Both dependencies are mocked: the point of these tests is *whether* the
// Firebase SDK gets booted at all, so a real one would defeat them.
vi.mock('../config', () => ({
  FEATURES: { cloudAI: true },
  isCloudAIConfigured: vi.fn(() => true),
}))
vi.mock('../auth/firebase', () => ({
  subscribeAuth: vi.fn(() => () => {}),
  signInWithGoogle: vi.fn(async () => ({}) as User),
  signOutUser: vi.fn(async () => {}),
}))

import { isCloudAIConfigured } from '../config'
import { signInWithGoogle, signOutUser, subscribeAuth } from '../auth/firebase'
import { useAuth } from './useAuth'

const HINT = 'cocktail.signedIn'
const USER = { email: 'drinker@example.com' } as User

/** Fire the callback the hook handed to subscribeAuth. */
function emitAuth(user: User | null) {
  const cb = vi.mocked(subscribeAuth).mock.calls.at(-1)?.[0]
  act(() => cb?.(user))
}

beforeEach(() => {
  vi.mocked(isCloudAIConfigured).mockReturnValue(true)
})

afterEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
})

describe('useAuth — lazy Firebase boot', () => {
  // The invariant that matters: BarScreen is a primary tab, and booting the SDK
  // there would charge every offline user for an AI feature they never opened.
  it('does not touch Firebase for someone who has never signed in', () => {
    const { result } = renderHook(() => useAuth())

    expect(subscribeAuth).not.toHaveBeenCalled()
    expect(result.current.user).toBeNull()
    expect(result.current.aiAvailable).toBe(false)
    // We already know the answer, so nothing is pending.
    expect(result.current.ready).toBe(true)
  })

  it('restores a previous session when the hint is present', () => {
    localStorage.setItem(HINT, '1')
    const { result } = renderHook(() => useAuth())

    expect(subscribeAuth).toHaveBeenCalledTimes(1)
    expect(result.current.ready).toBe(false)

    emitAuth(USER)
    expect(result.current.user).toBe(USER)
    expect(result.current.aiAvailable).toBe(true)
    expect(result.current.ready).toBe(true)
  })

  it('stays inert when the deployment has no Firebase project', () => {
    vi.mocked(isCloudAIConfigured).mockReturnValue(false)
    localStorage.setItem(HINT, '1') // even with a stale hint

    const { result } = renderHook(() => useAuth())
    expect(subscribeAuth).not.toHaveBeenCalled()
    expect(result.current.configured).toBe(false)
    expect(result.current.aiAvailable).toBe(false)
  })
})

describe('useAuth — sign in / out', () => {
  it('arms the subscription on sign-in, so the first one is observed', async () => {
    const { result } = renderHook(() => useAuth())
    expect(subscribeAuth).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.signIn()
    })

    expect(signInWithGoogle).toHaveBeenCalled()
    expect(subscribeAuth).toHaveBeenCalledTimes(1)

    emitAuth(USER)
    expect(result.current.aiAvailable).toBe(true)
    expect(localStorage.getItem(HINT)).toBe('1')
  })

  it('clears the hint on sign-out so the next cold start skips the SDK', async () => {
    localStorage.setItem(HINT, '1')
    const { result } = renderHook(() => useAuth())
    emitAuth(USER)

    await act(async () => {
      await result.current.signOut()
    })

    expect(signOutUser).toHaveBeenCalled()
    expect(localStorage.getItem(HINT)).toBeNull()
  })

  // A revoked or expired session resolves to null. Leaving the hint set would
  // make every future cold start pay for the SDK to rediscover that.
  it('clears the hint when a restored session turns out to be dead', () => {
    localStorage.setItem(HINT, '1')
    const { result } = renderHook(() => useAuth())

    emitAuth(null)
    expect(localStorage.getItem(HINT)).toBeNull()
    expect(result.current.aiAvailable).toBe(false)
    expect(result.current.ready).toBe(true)
  })
})
