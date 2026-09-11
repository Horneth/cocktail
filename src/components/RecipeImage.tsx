import { useEffect, useState } from 'react'
import { firebaseConfig } from '../config'
import { genRefKey, isGenRef, poolSrcSet, poolUrl } from '../domain/imagePool'
import type { PoolSize } from '../domain/imagePool'
import type { ReactNode } from 'react'
import styles from './RecipeImage.module.css'

interface Props {
  /** `Recipe.image`: a `gen:` pool reference, a data URL, or any https URL. */
  image?: string
  /** Which frame to prefer — the srcset still lets the browser pick smaller. */
  size: PoolSize
  /** CSS `sizes` hint matching how wide the image actually renders. */
  sizes?: string
  className?: string
  alt?: string
  /** Rendered when there's no image or a pool reference can't load (not yet
   *  generated, offline cold start) — normally the spirit tile. */
  fallback: ReactNode
  /** True while an on-demand generation is in flight for this recipe: shows a
   *  quiet shimmer instead of the tile, so the wait has a place to live. */
  generating?: boolean
}

/**
 * The one way a recipe photo renders. A `gen:` reference resolves to
 * content-addressed Storage URLs sized per context; anything the browser can
 * load directly (data URL, https) passes through untouched. A pool entry that
 * fails to load swaps to the fallback instead of showing a broken image —
 * that's what keeps signed-out / offline-cold / not-yet-generated recipes
 * looking intentional.
 */
export function RecipeImage({ image, size, sizes, className, alt = '', fallback, generating }: Props) {
  const [failed, setFailed] = useState(false)
  // A changed reference gets a fresh chance (e.g. the editor replaced a failed
  // pool pick with an upload).
  useEffect(() => setFailed(false), [image])

  const key = genRefKey(image)
  const bucket = firebaseConfig.storageBucket
  if (isGenRef(image) && key && bucket && !failed) {
    return (
      <img
        className={className}
        src={poolUrl(bucket, key, size)}
        srcSet={poolSrcSet(bucket, key)}
        sizes={sizes}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    )
  }

  // Generation in flight and nothing to show yet: a shimmer in the image's
  // place, not the tile — the tile says "no photo", the shimmer says "coming".
  if (generating && !image) {
    return <span className={`${styles.shimmer} ${className ?? ''}`} aria-hidden="true" />
  }

  // Direct sources (uploads, legacy URLs) render as-is; pool refs without a
  // configured bucket have nowhere to load from.
  if (image && !isGenRef(image) && !failed) {
    return (
      <img
        className={className}
        src={image}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    )
  }

  return <>{fallback}</>
}
