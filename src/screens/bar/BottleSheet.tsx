import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BottomSheet } from '../../components/BottomSheet'
import { BottleArt } from '../../components/BottleArt'
import { BottleGlyph } from '../../components/BottleGlyph'
import { CheckIcon, ChevronRightIcon } from '../../components/icons'
import { RecipeImage } from '../../components/RecipeImage'
import type { PantryItem, Recipe } from '../../db/schema'
import { makeableIds } from '../../domain/availability'
import { recipesUsingBottle, syrupRecipeFor } from '../../domain/barInsights'
import { displayImage } from '../../domain/imagePool'
import { categoryForName } from '../../domain/spiritCategory'
import { BOTTLE_TYPES, bottleTypeLabel, tileKeyForRecipe } from '../../domain/spirits'
import { spiritVisual } from '../../domain/spiritVisual'
import sheet from './sheet.module.css'
import styles from './BottleSheet.module.css'

interface Props {
  bottle: PantryItem | null
  onClose: () => void
  onRemove: (bottle: PantryItem) => void
  onSetCategory: (bottle: PantryItem, category: string) => void
  onRetryImage: (bottle: PantryItem) => void
  barName: string
  cocktails: Recipe[]
  byId: Map<string, Recipe>
  have: Set<string>
  assumeStaples: boolean
}

const MAX_DRINKS = 6

/** One bottle: what it is, what it lets you make, and how to get rid of it. */
export function BottleSheet({
  bottle,
  onClose,
  onRemove,
  onSetCategory,
  onRetryImage,
  barName,
  cocktails,
  byId,
  have,
  assumeStaples,
}: Props) {
  const [editingCategory, setEditingCategory] = useState(false)

  // Every drink this bottle has a part in, ready-now first. It used to be a
  // substring test against the bottle's own label, which meant a shelf of
  // Rittenhouse Rye listed nothing while the Old Fashioned happily reported
  // itself makeable — the same question, asked two ways. `recipesUsingBottle`
  // is the availability engine's own answer.
  const uses = useMemo(() => {
    if (!bottle) return []
    const all = recipesUsingBottle(bottle.label, cocktails, byId, bottle.category)
    const ready = makeableIds(all, byId, have, assumeStaples)
    return all
      .map((recipe) => ({ recipe, ready: ready.has(recipe.id) }))
      .sort((a, b) => Number(b.ready) - Number(a.ready))
  }, [bottle, cocktails, have, byId, assumeStaples])
  const readyCount = uses.filter((u) => u.ready).length

  const category = bottle ? (bottle.category ?? categoryForName(bottle.label)) : undefined
  const visual = spiritVisual(category ?? 'other')
  // A stocked syrup is also a recipe the user wrote — the bridge that makes the
  // two views one entity: the bottle sheet points back at the recipe page.
  const recipe = useMemo(
    () => (bottle ? syrupRecipeFor(bottle.label, [...byId.values()]) : undefined),
    [bottle, byId],
  )

  return (
    <BottomSheet
      open={!!bottle}
      onClose={() => {
        setEditingCategory(false)
        onClose()
      }}
      presentation="screen"
    >
      {bottle && (
        <>
          <div className={styles.hero} style={{ background: `linear-gradient(180deg, ${visual.tint}, var(--paper))` }}>
            <div className={styles.heroArt} aria-hidden>
              <BottleArt
                name={bottle.label}
                category={category ?? 'other'}
                image={bottle.image}
                imageStatus={bottle.imageStatus}
                size={190}
              />
            </div>
          </div>
          <div className={styles.head}>
            <div className={styles.headText}>
              <span className={sheet.title}>{bottle.label}</span>
              {bottle.brand && bottle.brand !== bottle.label && (
                <span className={sheet.subtitle}>{bottle.brand}</span>
              )}
            </div>
          </div>
          {bottle.imageStatus === 'pending' && <p className={styles.imageNote}>Creating portrait…</p>}
          {bottle.imageStatus === 'failed' && (
            <div className={styles.imageNote}>
              {bottle.imageError === 'daily-limit' ? 'Daily image limit reached. Try again tomorrow.' : 'Portrait unavailable.'}
              <button className={styles.retry} onClick={() => onRetryImage(bottle)}>Try again</button>
            </div>
          )}

          <button
            className={styles.categoryBtn}
            onClick={() => setEditingCategory((v) => !v)}
            aria-label="Change spirit category"
          >
            <span className={styles.categoryDot} style={{ background: visual.dot }} aria-hidden />
            {category ? bottleTypeLabel(category) : 'No type set'}
            <ChevronRightIcon size={15} className={styles.categoryChevron} />
          </button>
          {editingCategory && (
            <div className={styles.chips}>
              {BOTTLE_TYPES.map((key) => {
                const v = spiritVisual(key)
                return (
                  <button
                    key={key}
                    className={`${styles.chip} ${category === key ? styles.chipOn : ''}`}
                    onClick={() => {
                      onSetCategory(bottle, key)
                      setEditingCategory(false)
                    }}
                  >
                    <BottleGlyph shape={v.silhouette} size={13} color={v.dot} /> {bottleTypeLabel(key)}
                  </button>
                )
              })}
            </div>
          )}

          {recipe && (
            <Link className={styles.recipeLink} to={`/recipe/${recipe.id}`} onClick={onClose}>
              View recipe
            </Link>
          )}

          <div className={styles.sectionHead}>
            <p className={styles.sectionLabel}>
              {uses.length ? `Pours in ${uses.length} · ${readyCount} ready` : 'Pours in'}
            </p>
            {uses.length > MAX_DRINKS && (
              <Link
                className={styles.seeAll}
                to={`/?ingredient=${encodeURIComponent(bottle.label)}${
                  category ? `&family=${encodeURIComponent(category)}` : ''
                }`}
                onClick={onClose}
              >
                See all
              </Link>
            )}
          </div>
          {uses.length === 0 ? (
            <p className={styles.none}>No recipe calls for this yet.</p>
          ) : (
            <div className={styles.drinks}>
              {uses.slice(0, MAX_DRINKS).map(({ recipe, ready }) => {
                const v = spiritVisual(tileKeyForRecipe(recipe))
                return (
                  <Link
                    key={recipe.id}
                    to={`/recipe/${recipe.id}`}
                    className={`${styles.drink} ${ready ? styles.drinkReady : ''}`}
                    onClick={onClose}
                  >
                    <RecipeImage
                      image={displayImage(recipe)}
                      size="thumb"
                      sizes="44px"
                      className={styles.drinkThumb}
                      fallback={
                        <span className={styles.drinkThumb} style={{ background: v.tint }}>
                          {v.emoji}
                        </span>
                      }
                    />
                    <span className={styles.drinkName}>{recipe.name}</span>
                    {ready && <CheckIcon size={16} className={styles.drinkCheck} />}
                  </Link>
                )
              })}
            </div>
          )}

          <button className={styles.remove} onClick={() => onRemove(bottle)}>
            Remove from {barName}
          </button>
        </>
      )}
    </BottomSheet>
  )
}
