// Types for poolKey.mjs (plain ESM shared with the seeder script and the
// Cloud Function, which import the .mjs directly).

export interface PoolSizeSpec {
  w: number
  h: number
  /** true = centre-crop to this frame, false = keep the generated 3:4 */
  crop: boolean
}

export type PoolSizeName = 'thumb' | 'card' | 'full'

export declare const POOL_V: string
export declare const POOL_SIZES: Record<PoolSizeName, PoolSizeSpec>
export declare const MAX_NAME: number
export declare const MAX_INGREDIENTS: number

export declare function slugifyPoolKey(name: string): string
export declare function poolKeyForName(name: string): string
export declare function sanitizeDrinkName(name: string): string
export declare function poolPath(key: string, size: PoolSizeName): string
