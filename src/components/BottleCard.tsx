import { useEffect, useState } from 'react'
import { BottleGlyph } from './BottleGlyph'
import { SyrupBottle } from './SyrupBottle'
import { bottlePortraitFor, categoryPortraitFor } from '../domain/bottleVisual'
import { spiritVisual } from '../domain/spiritVisual'
import styles from './BottleCard.module.css'

interface Props {
  label: string
  brand?: string
  category: string
  /** how many library drinks this bottle pours into (hidden when 0) */
  pours?: number
  onClick: () => void
}

/**
 * One bottle on the shelf: the same card anatomy as the Recipes grid (photo,
 * serif name, quiet second line) so the two tabs read as siblings. The photo
 * is the bottle's own name-keyed portrait when one exists, stepping down to
 * the generic category portrait, then the family glyph on its tint.
 */
export function BottleCard({ label, brand, category, pours = 0, onClick }: Props) {
  const [stage, setStage] = useState(0)
  useEffect(() => setStage(0), [label, category])

  const src =
    stage === 0 ? bottlePortraitFor(label) : stage === 1 ? categoryPortraitFor(category) : undefined
  const v = spiritVisual(category)

  return (
    <button className={styles.card} onClick={onClick}>
      <span className={styles.photo} aria-hidden>
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className={styles.photoImg}
            onError={() => setStage((s) => s + 1)}
          />
        ) : category === 'syrup' ? (
          <span className={styles.photoGlyph} style={{ background: v.tint }}>
            <SyrupBottle name={label} size={110} />
          </span>
        ) : (
          <span className={styles.photoGlyph} style={{ background: v.tint }}>
            <BottleGlyph shape={v.silhouette} size={56} color={v.dot} />
          </span>
        )}
      </span>
      <span className={styles.foot}>
        <span className={styles.name}>{label}</span>
        {pours > 0 ? (
          <span className={styles.pours}>
            <i aria-hidden /> {pours} drink{pours > 1 ? 's' : ''}
          </span>
        ) : brand && brand !== label ? (
          <span className={styles.brand}>{brand}</span>
        ) : null}
      </span>
    </button>
  )
}