import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BottomSheet } from '../../components/BottomSheet'
import { ChevronRightIcon } from '../../components/icons'
import type { PantryItem, Recipe } from '../../db/schema'
import { canMake } from '../../domain/availability'
import { categoryForName } from '../../domain/spiritCategory'
import { KNOWN_SPIRITS } from '../../domain/spirits'
import { spiritVisual } from '../../domain/spiritVisual'
import sheet from './sheet.module.css'
import styles from './BottleSheet.module.css'

interface Props {
  bottle: PantryItem | null
  onClose: () => void
  onRemove: (bottle: PantryItem) => void
  onSetCategory: (bottle: PantryItem, category: string) => void
  barName: string
  cocktails: Recipe[]
  byId: Map<string, Recipe>
  have: Set<string>
  assumeStaples: boolean
}

const MAX_DRINKS = 4

/** One bottle: what it is, what it lets you make, and how to get rid of it. */
export function BottleSheet({
  bottle,
  onClose,
  onRemove,
  onSetCategory,
  barName,
  cocktails,
  byId,
  have,
  assumeStaples,
}: Props) {
  const [editingCategory, setEditingCategory] = useState(false)

  // Drinks this bottle is actually part of AND that you can make right now —
  // "enables" has to mean both, or it reads as a promise the bar can't keep.
  const enables = useMemo(() => {
    if (!bottle) return []
    return cocktails.filter(
      (r) =>
        r.ingredients?.some((ing) => ing.name.toLowerCase().includes(bottle.label.toLowerCase())) &&
        canMake(r, have, byId, assumeStaples),
    )
  }, [bottle, cocktails, have, byId, assumeStaples])

  const category = bottle ? (bottle.category ?? categoryForName(bottle.label)) : undefined
  const visual = spiritVisual(category ?? 'other')

  return (
    <BottomSheet
      open={!!bottle}
      onClose={() => {
        setEditingCategory(false)
        onClose()
      }}
      draggable
    >
      {bottle && (
        <>
          <div className={styles.head}>
            <span className={styles.glyph} style={{ background: visual.tint }} aria-hidden>
              {visual.emoji}
            </span>
            <span className={styles.headText}>
              <span className={sheet.title}>{bottle.label}</span>
              {bottle.brand && bottle.brand !== bottle.label && (
                <span className={sheet.subtitle}>{bottle.brand}</span>
              )}
            </span>
          </div>

          <button
            className={styles.categoryBtn}
            onClick={() => setEditingCategory((v) => !v)}
            aria-label="Change spirit category"
          >
            <span className={styles.categoryDot} style={{ background: visual.dot }} aria-hidden />
            {category ? visual.label : 'No type set'}
            <ChevronRightIcon size={15} className={styles.categoryChevron} />
          </button>
          {editingCategory && (
            <div className={styles.chips}>
              {KNOWN_SPIRITS.map((key) => {
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
                    <span aria-hidden>{v.emoji}</span> {v.label}
                  </button>
                )
              })}
            </div>
          )}

          <p className={styles.sectionLabel}>
            {enables.length ? `Ready to make (${enables.length})` : 'Ready to make'}
          </p>
          {enables.length === 0 ? (
            <p className={styles.none}>Nothing yet — this bottle needs company.</p>
          ) : (
            <div className={styles.drinks}>
              {enables.slice(0, MAX_DRINKS).map((r) => (
                <Link key={r.id} to={`/recipe/${r.id}`} className={styles.drink} onClick={onClose}>
                  {r.name}
                </Link>
              ))}
              {enables.length > MAX_DRINKS && (
                <span className={styles.more}>+{enables.length - MAX_DRINKS} more</span>
              )}
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
