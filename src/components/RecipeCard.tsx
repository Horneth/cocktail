import { Link } from 'react-router-dom'
import type { Recipe } from '../db/schema'
import { summarize } from '../domain/recipeSummary'
import { setFavorite } from '../import/importRecipe'
import { FlaskIcon, HeartIcon } from './icons'
import { SwipeableRow } from './SwipeableRow'
import styles from './RecipeCard.module.css'

interface Props {
  recipe: Recipe
  onDelete: () => void
  showHeart?: boolean
  showSpirit?: boolean
}

/** A swipeable recipe row with an optional favorite heart and spirit tag. */
export function RecipeCard({ recipe, onDelete, showHeart = true, showSpirit = false }: Props) {
  return (
    <SwipeableRow onDelete={onDelete}>
      <div className={styles.card}>
        <Link className={styles.cardBody} to={`/recipe/${recipe.id}`} draggable={false}>
          <div className={styles.cardMain}>
            <span className={styles.cardName}>
              {recipe.kind === 'component' && <FlaskIcon size={15} className={styles.cardFlask} />}
              {recipe.name}
            </span>
            <span className={styles.cardSub}>{summarize(recipe)}</span>
          </div>
          {showSpirit && recipe.spirit && recipe.spirit !== 'none' && (
            <span className={styles.spiritTag}>{recipe.spirit}</span>
          )}
        </Link>
        {showHeart && (
          <button
            className={`${styles.heart} ${recipe.favorite ? styles.heartOn : ''}`}
            aria-label={recipe.favorite ? 'Unfavorite' : 'Favorite'}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              void setFavorite(recipe.id, !recipe.favorite)
            }}
          >
            <HeartIcon size={20} filled={!!recipe.favorite} />
          </button>
        )}
      </div>
    </SwipeableRow>
  )
}
