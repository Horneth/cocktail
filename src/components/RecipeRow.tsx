import { Link } from 'react-router-dom'
import type { Recipe } from '../db/schema'
import { summarize } from '../domain/recipeSummary'
import { tileKeyForRecipe } from '../domain/spirits'
import { spiritVisual } from '../domain/spiritVisual'
import { displayImage } from '../domain/imagePool'
import { RecipeImage } from './RecipeImage'
import { SyrupBottle } from './SyrupBottle'
import { SwipeableRow } from './SwipeableRow'
import styles from './RecipeRow.module.css'

export type Availability = 'ready' | 'missing' | null

interface Props {
  recipe: Recipe
  /** Availability badge; pass `null` to hide it (e.g. empty bar). */
  badge?: Availability
  onDelete?: () => void
}

/**
 * The list row reused on Home, Browse and Search: a spirit-tinted emoji
 * thumbnail (a drawn syrup bottle for mixers), name + ingredient summary, and
 * an optional Ready/Missing badge. Wrapped in swipe-to-delete when an
 * `onDelete` handler is supplied.
 */
export function RecipeRow({ recipe, badge = null, onDelete }: Props) {
  const v = spiritVisual(tileKeyForRecipe(recipe))
  const isSyrup = recipe.kind === 'syrup'
  const body = (
    <Link className={styles.row} to={`/recipe/${recipe.id}`} draggable={false}>
      <RecipeImage
        image={displayImage(recipe)}
        size="thumb"
        sizes="52px"
        className={styles.thumb}
        generating={recipe.imageStatus === 'pending'}
        fallback={
          isSyrup ? (
            <span className={styles.thumb} style={{ background: v.tint }}>
              <SyrupBottle name={recipe.name} size={26} />
            </span>
          ) : (
            <span className={styles.thumb} style={{ background: v.tint }}>
              {v.emoji}
            </span>
          )
        }
      />
      <span className={styles.main}>
        <span className={styles.name}>{recipe.name}</span>
        <span className={styles.sub}>{summarize(recipe)}</span>
      </span>
      {badge && (
        <span className={`${styles.badge} ${badge === 'ready' ? styles.ready : styles.missing}`}>
          {badge === 'ready' ? 'Ready' : 'Missing'}
        </span>
      )}
    </Link>
  )

  return onDelete ? <SwipeableRow onDelete={onDelete}>{body}</SwipeableRow> : body
}
