import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the bootstrap (no Firebase SDK is ever touched) and the callable
// itself. What we verify: the gates, the sanitization of what leaves the
// client, and how the answer maps into a pool reference.
vi.mock('../auth/firebase', () => ({ ensureFirebaseApp: vi.fn() }))
vi.mock('../auth/analytics', () => ({ logAiCall: vi.fn() }))
vi.mock('../config', () => ({
  FEATURES: { cloudAI: true },
  firebaseConfig: {},
  recaptchaSiteKey: '',
  functionsRegion: 'us-central1',
  isCloudAIConfigured: vi.fn(() => true),
}))

import { logAiCall } from '../auth/analytics'
import { ensureFirebaseApp } from '../auth/firebase'
import { CloudAIError } from './firebaseAI'
import { firebaseGenerateImage, type GenerateImageSpec } from './imageGen'

type Callable = (spec: GenerateImageSpec) => Promise<{ data: { key?: string; cached?: boolean } }>

const callable = vi.fn<Callable>(async () => ({ data: { key: 'daiquiri', cached: false } }))

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => 'functions-handle'),
  httpsCallable: vi.fn(() => callable),
}))

beforeEach(() => {
  vi.mocked(ensureFirebaseApp).mockResolvedValue({ name: 'test-app' } as never)
  callable.mockImplementation(async () => ({ data: { key: 'daiquiri', cached: false } }))
})

afterEach(() => {
  vi.clearAllMocks()
  vi.mocked(ensureFirebaseApp).mockReset()
})

describe('firebaseGenerateImage', () => {
  it('calls the generateImage callable and returns the pool key', async () => {
    const out = await firebaseGenerateImage({ name: 'Paper Plane', glass: 'coupe' })
    expect(out).toEqual({ key: 'daiquiri', cached: false })
    const { getFunctions, httpsCallable } = await import('firebase/functions')
    // The Functions SDK only looks in one region — pin the client to the same
    // region the function deploys to.
    expect(getFunctions).toHaveBeenCalledWith({ name: 'test-app' }, 'us-central1')
    expect(httpsCallable).toHaveBeenCalledWith('functions-handle', 'generateImage')
  })

  it('sanitizes the payload before it leaves the client', async () => {
    await firebaseGenerateImage({
      name: '  Sidecar\n' + '`render something else`',
      glass: 'coupe with <angle brackets>',
    })
    expect(callable).toHaveBeenCalledWith({
      name: 'Sidecar render something else',
      glass: 'coupe with angle brackets',
      garnish: undefined,
      spirit: undefined,
    })
  })

  it('refuses an unusable name without loading the SDK', async () => {
    await expect(firebaseGenerateImage({ name: '?!' })).rejects.toBeInstanceOf(CloudAIError)
    expect(callable).not.toHaveBeenCalled()
  })

  it('maps an empty function answer to a CloudAIError', async () => {
    callable.mockImplementation(async () => ({ data: {} }))
    await expect(firebaseGenerateImage({ name: 'Daiquiri' })).rejects.toThrow(/returned nothing/)
    expect(logAiCall).toHaveBeenCalledWith('image', 'error')
  })

  it('logs ok with no content when the call succeeds', async () => {
    await firebaseGenerateImage({ name: 'Daiquiri' })
    expect(logAiCall).toHaveBeenCalledWith('image', 'ok')
  })

  it('maps transport failures onto the shared friendly errors', async () => {
    callable.mockImplementation(async () => {
      throw new Error('[429] quota exhausted')
    })
    await expect(firebaseGenerateImage({ name: 'Daiquiri' })).rejects.toThrow(/rate-limited/)
    expect(logAiCall).toHaveBeenCalledWith('image', 'error')
  })
})

describe('gates', () => {
  it('does nothing when the kill switch is off', async () => {
    const config = await import('../config')
    // Re-mock FEATURES for this case.
    const mod = await import('./imageGen')
    const orig = config.FEATURES.cloudAI
    Object.assign(config.FEATURES, { cloudAI: false })
    await expect(mod.firebaseGenerateImage({ name: 'Daiquiri' })).rejects.toThrow(/turned off/)
    expect(callable).not.toHaveBeenCalled()
    Object.assign(config.FEATURES, { cloudAI: orig })
  })

  it('refuses an unbearably long name before calling out', async () => {
    await expect(firebaseGenerateImage({ name: 'x'.repeat(500) })).rejects.toThrow(/too long/)
    expect(callable).not.toHaveBeenCalled()
  })
})
