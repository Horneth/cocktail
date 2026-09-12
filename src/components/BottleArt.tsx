import { BottleGlyph } from './BottleGlyph'
import { SyrupBottle } from './SyrupBottle'
import { spiritVisual } from '../domain/spiritVisual'

interface Props {
  /** the bottle's label — decides a syrup's liquid colour */
  name: string
  /** the bottle's stored/inferred category key */
  category: string
  size?: number
  className?: string
}

/**
 * The one bottle visual for My Bar: a syrup draws its bottle with its liquid
 * colour (the same art as the recipe side — one entity, two views); every
 * other category keeps the family silhouette in its token colour.
 */
export function BottleArt({ name, category, size = 20, className }: Props) {
  if (category === 'syrup') return <SyrupBottle name={name} size={size} className={className} />
  const v = spiritVisual(category)
  return <BottleGlyph shape={v.silhouette} size={size} color={v.dot} className={className} />
}