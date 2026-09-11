import { useEffect, useState } from 'react'
import { firebaseConfig } from '../config'
import { genRefKey, isGenRef, poolSrcSet, poolUrl } from '../domain/imagePool'
import type { PoolSize } from '../domain/imagePool'
import type { ReactNode } from 'react'

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
}

/**
 * The one way a recipe photo renders. A `gen:` reference resolves to
 * content-addressed Storage URLs sized per context; anything the browser can
 * load directly (data URL, https) passes through untouched. A pool entry that
 * fails to load swaps to the fallback instead of showing a broken image —
 * that's what keeps signed-out / offline-cold / not-yet-generated recipes
 * looking intentional.
 */
export function RecipeImage({ image, size, sizes, className, alt = '', fallback }: Props) {
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
