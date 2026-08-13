import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above the imports, so the doubles have to be too.
const { getApp, getAnalytics, isSupported, logEvent, config } = vi.hoisted(() => ({
  getApp: vi.fn(),
  getAnalytics: vi.fn(),
  isSupported: vi.fn(),
  logEvent: vi.fn(),
  config: { measurementId: 'G-TEST' },
}))

vi.mock('firebase/app', () => ({ getApp }))
vi.mock('firebase/analytics', () => ({ getAnalytics, isSupported, logEvent }))
vi.mock('../config', () => ({ firebaseConfig: config }))

import { logAiCall, resetAnalyticsForTests } from './analytics'

/**
 * logAiCall is fire-and-forget, so tests have to let its detached promise chain
 * finish. Several turns, not one: the chain awaits two dynamic imports before it
 * reaches logEvent, and a second concurrent call adds more hops still.
 */
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  config.measurementId = 'G-TEST'
  getApp.mockReturnValue({ name: '[DEFAULT]' })
  getAnalytics.mockReturnValue({ app: {} })
  isSupported.mockResolvedValue(true)
  resetAnalyticsForTests()
})
afterEach(() => vi.clearAllMocks())

describe('logAiCall', () => {
  it('records the call kind, outcome and yield', async () => {
    logAiCall('parse', 'ok', { results: 3 })
    await settle()
    expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'ai_call', {
      kind: 'parse',
      outcome: 'ok',
      results: 3,
    })
  })

  it('omits results when there is nothing to report', async () => {
    logAiCall('vision', 'error')
    await settle()
    expect(logEvent).toHaveBeenCalledWith(expect.anything(), 'ai_call', {
      kind: 'vision',
      outcome: 'error',
    })
  })

  it('keeps `results: 0` — an empty parse is an outcome, not a missing value', async () => {
    logAiCall('parse', 'ok', { results: 0 })
    await settle()
    expect(logEvent.mock.calls[0][2]).toMatchObject({ results: 0 })
  })

  // The app's premise is that the library never leaves the device. A metrics
  // pipeline is not an exception, so the payload is a closed set of scalars.
  it('sends only counts and enums — never content', async () => {
    logAiCall('dupes', 'ok', { results: 2 })
    await settle()
    const params = logEvent.mock.calls[0][2] as Record<string, unknown>
    expect(Object.keys(params).sort()).toEqual(['kind', 'outcome', 'results'])
    for (const value of Object.values(params)) {
      expect(['string', 'number']).toContain(typeof value)
    }
  })

  it('stays silent without a measurement ID, rather than half-configured', async () => {
    config.measurementId = ''
    resetAnalyticsForTests()
    logAiCall('parse', 'ok')
    await settle()
    expect(getAnalytics).not.toHaveBeenCalled()
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('never boots Firebase — it reads the app that a prior AI call initialized', async () => {
    // This is the invariant scripts/smoke.mjs guards from the outside: nothing
    // here may cause the SDK to initialize for a user who never used AI.
    getApp.mockImplementation(() => {
      throw new Error('No Firebase App has been created')
    })
    logAiCall('parse', 'ok')
    await settle()
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('does nothing where analytics is unsupported', async () => {
    isSupported.mockResolvedValue(false)
    logAiCall('parse', 'ok')
    await settle()
    expect(getAnalytics).not.toHaveBeenCalled()
    expect(logEvent).not.toHaveBeenCalled()
  })

  it('swallows a logging failure — measurement must never break an import', async () => {
    logEvent.mockImplementation(() => {
      throw new Error('transport exploded')
    })
    expect(() => logAiCall('parse', 'ok')).not.toThrow()
    await settle()
  })

  it('retries after a transient boot failure instead of disabling itself', async () => {
    isSupported.mockRejectedValueOnce(new Error('network blip'))
    logAiCall('parse', 'ok')
    await settle()
    expect(logEvent).not.toHaveBeenCalled()

    logAiCall('parse', 'ok')
    await settle()
    expect(logEvent).toHaveBeenCalledTimes(1)
  })

  it('boots once and reuses the handle across calls', async () => {
    logAiCall('parse', 'ok')
    logAiCall('vision', 'ok')
    await settle()
    expect(getAnalytics).toHaveBeenCalledTimes(1)
    expect(logEvent).toHaveBeenCalledTimes(2)
  })
})
