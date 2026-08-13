import { initializeApp } from 'firebase-admin/app'
import { onCall } from 'firebase-functions/v2/https'
import { getFirestore } from 'firebase-admin/firestore'
import { monthKey, tierFor, type UsageSnapshot } from './usage'

initializeApp()

export { aiParse, aiJudgeDuplicates, aiIdentifyBottles, aiReconcileBottles } from './ai'

/**
 * Tier and counters for the signed-in user, without spending anything.
 *
 * This exists so the client never needs the Firestore SDK. Adding it would put
 * a few hundred KB back into a bundle we're busy shrinking, break the
 * signed-out "no Firebase chunk" assertion in `scripts/smoke.mjs`, and make
 * "the app has no cloud copy of your library" stop being literally true.
 * Entitlement rides back on the AI responses; this is the cold-start read.
 */
export const getAccountStatus = onCall(
  { enforceAppCheck: true, maxInstances: 10 },
  async (request): Promise<UsageSnapshot | null> => {
    const uid = request.auth?.uid
    if (!uid) return null

    const rootRef = getFirestore().doc(`usage/${uid}`)
    const [tier, rootSnap, monthSnap] = await Promise.all([
      tierFor(uid),
      rootRef.get(),
      rootRef.collection('months').doc(monthKey()).get(),
    ])
    const count = (d: unknown) => {
      const v = (d ?? {}) as { parse?: unknown; scan?: unknown }
      return { parse: Number(v.parse) || 0, scan: Number(v.scan) || 0 }
    }
    return {
      tier,
      lifetime: count(rootSnap.data()?.lifetime),
      month: count(monthSnap.data()),
    }
  },
)
