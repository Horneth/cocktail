import { BottleGlyph } from './BottleGlyph'
import { syrupArt } from '../domain/syrupArt'

interface Props {
  /** the syrup's name — decides the liquid colour and the silhouette */
  name: string
  size?: number
  className?: string
}

/**
 * The drawn bottle for a syrup recipe: a generic silhouette filled with that
 * syrup's liquid colour (`domain/syrupArt.ts`). Deterministic, instant, and
 * free — syrups are ingredients, so their art never spends a generation; the
 * only thing that beats it is a photo the user uploaded themselves.
 */
export function SyrupBottle({ name, size = 24, className }: Props) {
  const art = syrupArt(name)
  return <BottleGlyph shape={art.shape} size={size} color={art.fill} className={className} />
}