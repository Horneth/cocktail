import type { Analytics } from 'firebase/analytics'
import { firebaseConfig } from '../config'

// Usage instrumentation for the four AI calls, and nothing else.
//
// It exists to answer one question we currently can't: how much AI does a real
// user actually consume in a month? Every decision about a free allowance or a
// price is a guess until that distribution is known, and guessing it wrong is
// expensive in both directions — too tight and you throttle the thing people
// came for, too loose and you can never take it back.
//
// Three rules this file must keep:
//
// 1. **Never boot Firebase.** `useAuth` deliberately doesn't subscribe on mount
//    (see docs/cloud-ai-backend.md, "Lazy boot") and `scripts/smoke.mjs` asserts
//    the SDK chunk is never fetched for a signed-out user. So this reaches for
//    `getApp()` — the *already* initialized app — and gives up if there isn't
//    one. It can only ever run after an AI call, which required a boot anyway.
// 2. **Never throw, never block.** An analytics failure must not turn into a
//    failed import. Everything is fire-and-forget behind a swallowed catch.
// 3. **Never log content.** No recipe names, no bottle names, no pasted text,
//    no photos. Counts and outcomes only. The app's whole premise is that the
//    library stays on the device, and a metrics pipeline is not an exception.

/** Which of the calls. Mirrors the metering units a paid tier would use. */
export type AiCallKind = 'parse' | 'dupes' | 'vision' | 'reconcile'

export interface AiCallFacts {
  /**
   * How much the call gave back — recipes parsed, bottles read, verdicts
   * returned. A parse that yields four recipes is worth more than one that
   * yields one, and an allowance set per *call* would price those the same.
   */
  results?: number
}

/**
 * The handle and the log function together, resolved once. Keeping `logEvent`
 * here rather than re-importing it per call means exactly one dynamic import for
 * the session — and avoids a second concurrent `import()` on the hot path, which
 * is a way to silently drop an event.
 */
interface Sink {
  analytics: Analytics
  logEvent: (a: Analytics, name: string, params: Record<string, unknown>) => void
}

let sink: Promise<Sink | null> | null = null

function boot(): Promise<Sink | null> {
  return (async () => {
    const [{ getApp }, mod] = await Promise.all([
      import('firebase/app'),
      import('firebase/analytics'),
    ])
    // Not supported in every browser or context (private modes, some embedded
    // webviews). `getApp()` throws when nothing has initialized it, which is the
    // guard that keeps rule 1 honest.
    if (!(await mod.isSupported())) return null
    return { analytics: mod.getAnalytics(getApp()), logEvent: mod.logEvent }
  })()
}

async function ensureSink(): Promise<Sink | null> {
  // No measurement ID means a fork, a bare checkout, or a deployment that
  // deliberately didn't opt in — stay silent rather than half-configured.
  if (!firebaseConfig.measurementId) return null
  if (!sink) {
    sink = boot().catch(() => {
      // Don't cache the failure: a transient one shouldn't disable measurement
      // for the rest of the session.
      sink = null
      return null
    })
  }
  return sink
}

/**
 * Record that an AI call happened. Fire-and-forget by design — callers must not
 * await this, and it resolves rather than rejects on every failure path.
 */
export function logAiCall(
  kind: AiCallKind,
  outcome: 'ok' | 'error',
  facts: AiCallFacts = {},
): void {
  void (async () => {
    try {
      const s = await ensureSink()
      if (!s) return
      s.logEvent(s.analytics, 'ai_call', {
        kind,
        outcome,
        ...(typeof facts.results === 'number' ? { results: facts.results } : {}),
      })
    } catch {
      // Rule 2. Measurement is never worth a user-visible failure.
    }
  })()
}

/** Test seam: forget the cached handle so a case can start from a clean boot. */
export function resetAnalyticsForTests(): void {
  sink = null
}
