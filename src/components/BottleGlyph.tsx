import { BOTTLE_PATHS, type BottleShape } from '../domain/spiritVisual'

interface Props {
  shape: BottleShape
  size?: number
  className?: string
  /** Defaults to `currentColor`; pass the category's `dot` on a `tint` chip. */
  color?: string
}

/**
 * A solid bottle silhouette per spirit category — the one bottle visual the
 * Bar screens share. Shape is the family resemblance, colour the distinction:
 * paint the category's `dot` on its `tint` chip (`spiritVisual()` supplies
 * both). Path data lives in `domain/spiritVisual.ts` so it stays pure and
 * testable.
 */
export function BottleGlyph({ shape, size = 20, className, color }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={color ? { color } : undefined}
      aria-hidden
    >
      <path d={BOTTLE_PATHS[shape]} fill="currentColor" />
    </svg>
  )
}