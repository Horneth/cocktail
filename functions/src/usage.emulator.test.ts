import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { initializeApp, deleteApp, type App } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { charge, monthKey, tierFor } from './usage'

// Metering is the one part of the backend with real branching — a transaction,
// a fail-closed ceiling, and an entitlement that expires. Unit tests can't cover
// it without reimplementing Firestore, so this runs against the emulator.
//
//   firebase emulators:start --only firestore
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest run usage.emulator
//
// Skipped (not failed) without an emulator, so `npm test` stays fast and green
// on a machine that hasn't started one.
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST
const suite = EMULATOR ? describe : describe.skip

suite('metering against the Firestore emulator', () => {
  let app: App

  beforeAll(() => {
    app = initializeApp({ projectId: 'cocktails-c2705' })
  })
  afterAll(async () => {
    await deleteApp(app)
  })

  beforeEach(async () => {
    const db = getFirestore()
    for (const path of ['usage', 'entitlements', 'config']) {
      const docs = await db.collection(path).listDocuments()
      for (const doc of docs) {
        const subs = await doc.listCollections()
        for (const sub of subs) {
          for (const s of await sub.listDocuments()) await s.delete()
        }
        await doc.delete()
      }
    }
  })

  it('increments lifetime and month together', async () => {
    const first = await charge('u1', 'parse')
    expect(first).toEqual({
      tier: 'free',
      lifetime: { parse: 1, scan: 0 },
      month: { parse: 1, scan: 0 },
    })

    const second = await charge('u1', 'parse')
    expect(second.lifetime.parse).toBe(2)
    expect(second.month.parse).toBe(2)

    // Units are counted separately — a scan must not spend an import.
    const scan = await charge('u1', 'scan')
    expect(scan.lifetime).toEqual({ parse: 2, scan: 1 })
  })

  it('writes the month under a UTC key', async () => {
    await charge('u2', 'scan')
    const snap = await getFirestore().doc(`usage/u2/months/${monthKey()}`).get()
    expect(snap.data()?.scan).toBe(1)
  })

  it('keeps users independent', async () => {
    await charge('u3', 'parse')
    const other = await charge('u4', 'parse')
    expect(other.lifetime.parse).toBe(1)
  })

  it('fails closed at the abuse ceiling rather than letting a script run away', async () => {
    await getFirestore().doc('config/ai').set({ enabled: true, ceilingParse: 2, ceilingScan: 2 })
    // The config is cached for 60s; a fresh key sidesteps a previous test's cache.
    await new Promise((r) => setTimeout(r, 50))

    const uid = `ceiling-${monthKey()}`
    await charge(uid, 'parse').catch(() => {})
    await charge(uid, 'parse').catch(() => {})
    // Whatever the cached ceiling was, it is finite; drive well past it.
    let refused = false
    for (let i = 0; i < 400 && !refused; i += 1) {
      await charge(uid, 'parse').catch(() => {
        refused = true
      })
    }
    expect(refused).toBe(true)
  })

  it('reads pro from the entitlement doc, and treats a lapsed one as free', async () => {
    const db = getFirestore()
    await db.doc('entitlements/pro-user').set({ tier: 'pro' })
    expect(await tierFor('pro-user')).toBe('pro')

    await db.doc('entitlements/lapsed').set({
      tier: 'pro',
      proUntil: new Date(Date.now() - 1000),
    })
    // A cancellation webhook that never arrived must not leave someone paid
    // forever — proUntil self-expires.
    expect(await tierFor('lapsed')).toBe('free')

    expect(await tierFor('nobody')).toBe('free')
  })
})
