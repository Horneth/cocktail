import { useEffect, useState } from 'react'
import { BottleGlyph } from './BottleGlyph'
import { SyrupBottle } from './SyrupBottle'
import { bottlePortraitFor, categoryPortraitFor } from '../domain/bottleVisual'
import { spiritVisual } from '../domain/spiritVisual'

interface Props {
  /** the bottle's label — keys its name portrait, decides a syrup's liquid colour */
  name: string
  /** the bottle's stored/inferred category key */
  category: string
  size?: number
  className?: string
}

/**
 * The one bottle visual for My Bar. A syrup draws its bottle with its liquid
 * colour (the same art as the recipe side — one entity, two views). Any other
 * bottle shows its own name-keyed portrait when one exists, stepping down to
 * the generic category portrait, then the family silhouette — each level only
 * after the previous one fails to load (never generated, offline cold start).
 */
export function BottleArt({ name, category, size = 20, className }: Props) {
  const [stage, setStage] = useState(0)
  // A changed bottle or category gets a fresh walk down the chain.
  useEffect(() => setStage(0), [name, category])

  if (category === 'syrup') return <SyrupBottle name={name} size={size} className={className} />
  const src = stage === 0 ? bottlePortraitFor(name) : stage === 1 ? categoryPortraitFor(category) : undefined
  if (src) {
    return (
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        className={className}
        onError={() => setStage((s) => s + 1)}
      />
    )
  }
  const v = spiritVisual(category)
  return <BottleGlyph shape={v.silhouette} size={size} color={v.dot} className={className} />
}