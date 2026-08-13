import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'

// Entitlement and metering. Phase 1 deliberately **observes**: every AI call is
// counted, but nothing is refused for being over a tier's allowance, because the
// allowance and the price should come from real usage rather than a guess. The
// only thing that fails closed here is the abuse ceiling — a number no human
// reaches and a script reaches in minutes.

export type Unit = 'parse' | 'scan'
export type Tier = 'free' | 'pro'

export interface Counters {
  parse: number
  scan: number
}

export interface UsageSnapshot {
  tier: Tier
  /** Since the account existed. This is what a one-time trial will read. */
  lifetime: Counters
  /** Current calendar month, for fair-use on the paid tier. */
  month: Counters
}

interface AiConfig {
  enabled: boolean
  /** Fail-closed ceiling per user per month, per unit. Not a product limit. */
  ceiling: Counters
}

const DEFAULT_CONFIG: AiConfig = {
  enabled: true,
  ceiling: { parse: 300, scan: 100 },
}

// A Firestore read per AI call to fetch a config that changes maybe twice a year
// would be silly, but so would baking the kill switch into the deploy — the
// point of a kill switch is stopping the bleeding without one. 60s is the
// compromise: cheap, and short enough to be useful in an incident.
const CONFIG_TTL_MS = 60_000
let cachedConfig: { at: number; value: AiConfig } | null = null

export async function aiConfig(): Promise<AiConfig> {
  const now = Date.now()
  if (cachedConfig && now - cachedConfig.at < CONFIG_TTL_MS) return cachedConfig.value

  let value = DEFAULT_CONFIG
  try {
    const snap = await getFirestore().doc('config/ai').get()
    const data = snap.data()
    if (data) {
      value = {
        enabled: data.enabled !== false,
        ceiling: {
          parse: Number(data.ceilingParse) || DEFAULT_CONFIG.ceiling.parse,
          scan: Number(data.ceilingScan) || DEFAULT_CONFIG.ceiling.scan,
        },
      }
    }
  } catch {
    // A missing or unreadable config must not take AI down with it — the
    // defaults above are already the safe answer.
  }
  cachedConfig = { at: now, value }
  return value
}

/** `2026-08`. Month boundaries are UTC so a user can't gain a reset by travelling. */
export function monthKey(at: Date = new Date()): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * The entitlement, read from Firestore rather than from a custom claim. Claims
 * go stale: a refund or a chargeback doesn't invalidate an already-minted ID
 * token, and asking the client to refresh its own token is not enforcement. The
 * hot path already opens a transaction for the counter, so the read is close to
 * free.
 */
export async function tierFor(uid: string): Promise<Tier> {
  try {
    const snap = await getFirestore().doc(`entitlements/${uid}`).get()
    const data = snap.data()
    if (!data || data.tier !== 'pro') return 'free'
    // `proUntil` self-expires at period end, which covers a lapsed subscription
    // even if the cancellation webhook never arrived.
    const until = data.proUntil?.toMillis?.()
    if (typeof until === 'number' && until < Date.now()) return 'free'
    return 'pro'
  } catch {
    return 'free'
  }
}

/**
 * Count one billable call against a user, before it is made. Increments inside a
 * transaction and fails closed at the abuse ceiling — charging first means a
 * crash or a timeout costs the user a unit, which is the right way round when
 * the alternative is an unmetered retry loop.
 */
export async function charge(uid: string, unit: Unit): Promise<UsageSnapshot> {
  const config = await aiConfig()
  if (!config.enabled) {
    throw new HttpsError('unavailable', 'AI features are temporarily switched off.')
  }

  const db = getFirestore()
  const rootRef = db.doc(`usage/${uid}`)
  const monthRef = rootRef.collection('months').doc(monthKey())

  const [tier, snapshot] = await Promise.all([
    tierFor(uid),
    db.runTransaction(async (tx) => {
      const [rootSnap, monthSnap] = await Promise.all([tx.get(rootRef), tx.get(monthRef)])
      const lifetime = counters(rootSnap.data()?.lifetime)
      const month = counters(monthSnap.data())

      if (month[unit] >= config.ceiling[unit]) {
        throw new HttpsError(
          'resource-exhausted',
          "That's a lot of AI for one month — it's paused until next month.",
        )
      }

      tx.set(
        rootRef,
        { lifetime: { [unit]: FieldValue.increment(1) }, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
      tx.set(
        monthRef,
        { [unit]: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )

      // The pre-increment reads plus this call, rather than a re-read: the
      // client only uses these to render a counter.
      return {
        lifetime: { ...lifetime, [unit]: lifetime[unit] + 1 },
        month: { ...month, [unit]: month[unit] + 1 },
      }
    }),
  ])

  return { tier, ...snapshot }
}

function counters(data: unknown): Counters {
  const d = (data ?? {}) as { parse?: unknown; scan?: unknown }
  return { parse: Number(d.parse) || 0, scan: Number(d.scan) || 0 }
}
