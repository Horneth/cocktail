/**
 * The one generation failure the user can act on: the per-user daily limit.
 * Deliberately dependency-free so a screen can identify it with instanceof
 * without statically loading the Firebase transport (imageGen) — the same
 * laziness the transport itself keeps for the SDK.
 */
export class ImageLimitError extends Error {
  readonly kind = 'daily-limit' as const

  constructor(message = 'Daily image limit reached — try again tomorrow.') {
    super(message)
    this.name = 'ImageLimitError'
  }
}