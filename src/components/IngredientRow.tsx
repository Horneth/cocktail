import { Link } from 'react-router-dom'
import type { Ingredient, Unit } from '../db/schema'
import { scaledIngredient, type ScaleSettings } from '../domain/scaling'
import { formatAmount, toPreferred, unitDef, type VolumePreference } from '../domain/units'
import { ChevronRightIcon, MinusIcon, PlusIcon, UndoIcon } from './icons'
import styles from './IngredientRow.module.css'

export interface Override {
  amount: number
  unit: Unit
}

interface Props {
  ingredient: Ingredient
  scale: ScaleSettings
  pref: VolumePreference
  override?: Override
  editing: boolean
  onStartEdit: () => void
  onOverride: (value: Override | undefined) => void
}

/** The scaled + preference-converted display amount (before any override). */
function displayValue(
  ing: Ingredient,
  scale: ScaleSettings,
  pref: VolumePreference,
): Override | { amount: null; unit: Unit } {
  const scaled = scaledIngredient(ing, scale)
  if (scaled.amount === null) return { amount: null, unit: scaled.unit }
  const p = toPreferred(scaled.amount, scaled.unit, pref)
  return { amount: p.amount, unit: p.unit }
}

export function IngredientRow({
  ingredient,
  scale,
  pref,
  override,
  editing,
  onStartEdit,
  onOverride,
}: Props) {
  const base = displayValue(ingredient, scale, pref)
  const shown: { amount: number | null; unit: Unit } = override ?? base
  const isModified = override !== undefined

  const step = unitDef(shown.unit).step
  const bump = (dir: 1 | -1) => {
    const current = shown.amount ?? 0
    const next = Math.max(0, Math.round((current + dir * step) * 1000) / 1000)
    onOverride({ amount: next, unit: shown.unit })
  }

  const amountText =
    shown.amount === null
      ? formatAmount(null, shown.unit)
      : formatAmount(shown.amount, shown.unit)

  return (
    <div className={`${styles.row} ${ingredient.optional ? styles.optional : ''}`}>
      {editing ? (
        <div className={styles.tweaker}>
          <button className={styles.tweakBtn} aria-label="Less" onClick={() => bump(-1)}>
            <MinusIcon size={18} />
          </button>
          <span className={styles.tweakVal}>{amountText}</span>
          <button className={styles.tweakBtn} aria-label="More" onClick={() => bump(1)}>
            <PlusIcon size={18} />
          </button>
          {isModified && (
            <button
              className={styles.tweakBtn}
              aria-label="Reset"
              onClick={() => onOverride(undefined)}
            >
              <UndoIcon size={16} />
            </button>
          )}
        </div>
      ) : (
        <button
          className={`${styles.amount} ${isModified ? styles.amountMod : ''}`}
          onClick={onStartEdit}
        >
          {amountText || '—'}
          {isModified && <span className={styles.dot} aria-label="modified" />}
        </button>
      )}

      <div className={styles.body}>
        {ingredient.subRecipeId ? (
          <Link className={styles.linkName} to={`/recipe/${ingredient.subRecipeId}`}>
            <span>{ingredient.name}</span>
            <ChevronRightIcon size={16} className={styles.chev} />
          </Link>
        ) : (
          <span className={styles.name}>{ingredient.name}</span>
        )}
        {(ingredient.note || ingredient.optional) && (
          <span className={styles.meta}>
            {ingredient.note}
            {ingredient.note && ingredient.optional ? ' · ' : ''}
            {ingredient.optional ? 'optional' : ''}
          </span>
        )}
      </div>
    </div>
  )
}
