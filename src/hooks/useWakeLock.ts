import { useEffect } from 'react'

// Minimal shape of the Screen Wake Lock API, cast in locally so the hook doesn't
// depend on the DOM lib shipping it.
interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
}
interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

/**
 * Keep the screen awake while a screen is open.
 *
 * Making a drink is a two-handed job with the phone propped on the counter, and
 * the auto-dim lands somewhere around the second ingredient — you end up wiping
 * a wet thumb on your shirt to read the next line. Video players hold the same
 * lock for the same reason.
 *
 * Best-effort by design: browsers without the API, and requests refused because
 * the tab is hidden or the battery is low, just let the screen behave normally.
 * The lock is handed back whenever the page is hidden, so re-request on return.
 */
export function useWakeLock(active = true): void {
  useEffect(() => {
    if (!active) return
    const api = (navigator as unknown as { wakeLock?: WakeLockLike }).wakeLock
    if (!api) return

    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return
      try {
        const held = await api.request('screen')
        if (cancelled) void held.release()
        else sentinel = held
      } catch {
        /* refused — the screen just dims as it normally would */
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (sentinel && !sentinel.released) void sentinel.release()
      sentinel = null
    }
  }, [active])
}
