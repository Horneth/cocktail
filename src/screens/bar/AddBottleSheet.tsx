import { useEffect, useMemo, useRef, useState } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { CheckIcon, PlusIcon, SearchIcon } from '../../components/icons'
import type { Recipe } from '../../db/schema'
import { normIngredient } from '../../domain/availability'
import { oneAwaySuggestions, unlocksFor } from '../../domain/barInsights'
import type { BottleInput } from '../../domain/pantry'
import { categoryForName } from '../../domain/spiritCategory'
import { KNOWN_SPIRITS } from '../../domain/spirits'
import { spiritVisual } from '../../domain/spiritVisual'
import type { CatalogItem } from '../../hooks/useRecipes'
import sheet from './sheet.module.css'
import styles from './AddBottleSheet.module.css'

interface Props {
  open: boolean
  onClose: () => void
  onAdd: (bottles: BottleInput[]) => void
  /** every non-staple ingredient the library mentions */
  catalog: CatalogItem[]
  have: Set<string>
  cocktails: Recipe[]
  byId: Map<string, Recipe>
  assumeStaples: boolean
}

interface Suggestion extends CatalogItem {
  /** how many drinks this single bottle would unlock right now */
  unlocks: number
}

// Enough to scroll through without turning the sheet into a directory. The
// catalog is sorted by payoff first, so the tail is the least useful part.
const MAX_SUGGESTIONS = 40

/**
 * The manual path: add bottles with no AI, no sign-in and no network. Deliberately
 * imports nothing from `import/` or `auth/` — this is the sheet that has to work
 * for everyone, offline, forever.
 */
export function AddBottleSheet({
  open,
  onClose,
  onAdd,
  catalog,
  have,
  cocktails,
  byId,
  assumeStaples,
}: Props) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Map<string, BottleInput>>(new Map())
  const [customCategory, setCustomCategory] = useState<string | null>(null)
  const [pickingCategory, setPickingCategory] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setPicked(new Map())
    setCustomCategory(null)
    setPickingCategory(false)
    // A phone keyboard covering half the sheet on open is worse than one tap,
    // so focus without forcing the keyboard up until the user aims at the field.
    inputRef.current?.focus({ preventScroll: true })
  }, [open])

  // Bottles the user doesn't have yet, best payoff first. The unlock counts come
  // from the same on-device engine the Bar screen uses — nothing is sent anywhere.
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!open) return []
    const ranked = new Map(oneAwaySuggestions(cocktails, byId, have, assumeStaples, 8).map((s) => [s.name, s.unlocks]))
    return catalog
      .filter((c) => !have.has(c.name))
      .map((c) => ({ ...c, unlocks: ranked.get(c.name) ?? 0 }))
      .sort((a, b) => b.unlocks - a.unlocks || a.label.localeCompare(b.label))
  }, [open, catalog, have, cocktails, byId, assumeStaples])

  const q = query.trim()
  const shown = useMemo(() => {
    const list = q
      ? suggestions.filter((s) => s.label.toLowerCase().includes(q.toLowerCase()))
      : suggestions
    return list.slice(0, MAX_SUGGESTIONS)
  }, [suggestions, q])

  const customKey = normIngredient(q)
  // Offer a free-text add only when the typed name isn't already an option —
  // in the catalog, on the shelf, or picked in this session.
  const showCustom =
    !!customKey && !have.has(customKey) && !suggestions.some((s) => s.name === customKey) && !picked.has(customKey)
  const customGuess = customCategory ?? (q ? categoryForName(q) : undefined)

  const toggle = (name: string, bottle: BottleInput) =>
    setPicked((prev) => {
      const next = new Map(prev)
      if (next.has(name)) next.delete(name)
      else next.set(name, bottle)
      return next
    })

  const addCustom = () => {
    if (!showCustom) return
    toggle(customKey, { label: q, ...(customGuess ? { category: customGuess } : {}) })
    setQuery('')
    setCustomCategory(null)
    setPickingCategory(false)
    inputRef.current?.focus()
  }

  const chosen = [...picked.values()]
  const total = useMemo(
    () =>
      chosen.length ? unlocksFor(chosen.map((b) => b.label), cocktails, byId, have, assumeStaples).unlocks : 0,
    [chosen, cocktails, byId, have, assumeStaples],
  )

  return (
    <BottomSheet open={open} onClose={onClose} draggable>
      <div className={sheet.head}>
        <h2 className={sheet.title}>Add a bottle</h2>
        <p className={sheet.subtitle}>Pick as many as you like — nothing is saved until you confirm.</p>
      </div>

      <div className={styles.search}>
        <SearchIcon size={18} className={styles.searchIcon} />
        <input
          ref={inputRef}
          className={styles.searchInput}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCustomCategory(null)
            setPickingCategory(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && addCustom()}
          placeholder="Search or type a bottle…"
          aria-label="Search or type a bottle"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {showCustom && (
        <div className={styles.custom}>
          <button className={styles.customAdd} onClick={addCustom}>
            <PlusIcon size={16} />
            <span className={styles.customName}>Add “{q}”</span>
          </button>
          <button
            className={styles.customCat}
            onClick={() => setPickingCategory((v) => !v)}
            aria-label="Change spirit category"
          >
            {customGuess ? spiritVisual(customGuess).label : 'Set type'}
          </button>
        </div>
      )}
      {showCustom && pickingCategory && (
        <div className={styles.chips}>
          {KNOWN_SPIRITS.map((key) => {
            const v = spiritVisual(key)
            return (
              <button
                key={key}
                className={`${styles.chip} ${customGuess === key ? styles.chipOn : ''}`}
                onClick={() => {
                  setCustomCategory(key)
                  setPickingCategory(false)
                }}
              >
                <span aria-hidden>{v.emoji}</span> {v.label}
              </button>
            )
          })}
        </div>
      )}

      <div className={sheet.body}>
        {shown.length === 0 && !showCustom ? (
          <p className={sheet.hint}>
            {q ? 'No match — keep typing to add it as a new bottle.' : 'Every bottle your recipes call for is already on the shelf.'}
          </p>
        ) : (
          shown.map((s) => {
            const on = picked.has(s.name)
            const v = spiritVisual(categoryForName(s.label) ?? 'other')
            return (
              <button
                key={s.name}
                className={`${styles.row} ${on ? styles.rowOn : ''}`}
                onClick={() => toggle(s.name, { label: s.label })}
              >
                <span className={styles.glyph} style={{ background: v.tint }} aria-hidden>
                  {v.emoji}
                </span>
                <span className={styles.text}>
                  <span className={styles.label}>{s.label}</span>
                  {s.unlocks > 0 && <span className={styles.unlock}>unlocks {s.unlocks} drink{s.unlocks > 1 ? 's' : ''}</span>}
                </span>
                <span className={`${styles.tick} ${on ? styles.tickOn : ''}`}>
                  {on && <CheckIcon size={14} />}
                </span>
              </button>
            )
          })
        )}
      </div>

      <div className={sheet.actions}>
        <button className={sheet.ghost} onClick={onClose}>
          Cancel
        </button>
        <button className={sheet.solid} disabled={chosen.length === 0} onClick={() => onAdd(chosen)}>
          <span>
            Add {chosen.length || ''} bottle{chosen.length === 1 ? '' : 's'}
          </span>
          {total > 0 && (
            <span className={sheet.solidSub}>
              unlocks {total} drink{total > 1 ? 's' : ''}
            </span>
          )}
        </button>
      </div>
    </BottomSheet>
  )
}
