import { useEffect, useMemo, useRef, useState } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { CheckIcon, SearchIcon } from '../../components/icons'
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
  /** prefill, e.g. the ingredient a recipe sent you here to buy */
  initialQuery?: string
}

interface Suggestion extends CatalogItem {
  /** how many drinks this single bottle would unlock right now */
  unlocks: number
}

// Enough to scroll through without turning the sheet into a directory. The
// catalog is sorted by payoff first, so the tail is the least useful part.
const MAX_SUGGESTIONS = 40

// The key the category picker uses for the not-yet-added typed name.
const TYPED = '__typed__'

/**
 * The manual path: add bottles with no AI, no sign-in and no network. Deliberately
 * imports nothing from `import/` or `auth/` — this is the sheet that has to work
 * for everyone, offline, forever.
 *
 * A bottle no recipe mentions is a first-class row here, not a consolation
 * prize: same shape, same type control, same unlock count as anything the
 * library suggested. Your shelf is the fact; the recipes are the guesses.
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
  initialQuery,
}: Props) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Map<string, BottleInput>>(new Map())
  const [typedCategory, setTypedCategory] = useState<string | null>(null)
  /** which row has its type picker open (TYPED for the one being typed) */
  const [picking, setPicking] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery(initialQuery ?? '')
    setPicked(new Map())
    setTypedCategory(null)
    setPicking(null)
    // A phone keyboard covering half the sheet on open is worse than one tap,
    // so focus without forcing the keyboard up until the user aims at the field.
    inputRef.current?.focus({ preventScroll: true })
  }, [open, initialQuery])

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

  const typedKey = normIngredient(q)
  // Offer a free-text add only when the typed name isn't already an option —
  // in the catalog, on the shelf, or picked in this session.
  const showTyped =
    !!typedKey && !have.has(typedKey) && !suggestions.some((s) => s.name === typedKey) && !picked.has(typedKey)
  const typedGuess = typedCategory ?? (q ? categoryForName(q) : undefined)
  // A bottle nobody wrote a recipe for can still unlock drinks — a rye covers
  // every bourbon call. Worth saying, and it's the same on-device count.
  const typedUnlocks = useMemo(
    () => (showTyped ? unlocksFor([q], cocktails, byId, have, assumeStaples).unlocks : 0),
    [showTyped, q, cocktails, byId, have, assumeStaples],
  )

  const toggle = (name: string, bottle: BottleInput) =>
    setPicked((prev) => {
      const next = new Map(prev)
      if (next.has(name)) next.delete(name)
      else next.set(name, bottle)
      return next
    })

  const setCategory = (name: string, category: string) =>
    setPicked((prev) => {
      const bottle = prev.get(name)
      if (!bottle) return prev
      return new Map(prev).set(name, { ...bottle, category })
    })

  const addTyped = () => {
    if (!showTyped) return
    toggle(typedKey, { label: q, ...(typedGuess ? { category: typedGuess } : {}) })
    setQuery('')
    setTypedCategory(null)
    setPicking(null)
    inputRef.current?.focus()
  }

  // Picked bottles the library never mentioned would otherwise vanish the moment
  // the field clears — the count at the bottom being the only trace of them.
  const catalogKeys = useMemo(() => new Set(catalog.map((c) => c.name)), [catalog])
  const customPicks = [...picked.entries()].filter(([key]) => !catalogKeys.has(key))

  const chosen = [...picked.values()]
  const total = useMemo(
    () =>
      chosen.length ? unlocksFor(chosen.map((b) => b.label), cocktails, byId, have, assumeStaples).unlocks : 0,
    [chosen, cocktails, byId, have, assumeStaples],
  )

  const categoryChips = (selected: string | undefined, onPick: (key: string) => void) => (
    <div className={styles.chips}>
      {KNOWN_SPIRITS.map((key) => {
        const v = spiritVisual(key)
        return (
          <button
            key={key}
            className={`${styles.chip} ${selected === key ? styles.chipOn : ''}`}
            onClick={() => onPick(key)}
          >
            <span aria-hidden>{v.emoji}</span> {v.label}
          </button>
        )
      })}
    </div>
  )

  return (
    <BottomSheet open={open} onClose={onClose} draggable>
      <div className={sheet.head}>
        <h2 className={sheet.title}>Add a bottle</h2>
      </div>

      <div className={styles.search}>
        <SearchIcon size={18} className={styles.searchIcon} />
        <input
          ref={inputRef}
          className={styles.searchInput}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setTypedCategory(null)
            setPicking(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && addTyped()}
          placeholder="Search or type a bottle…"
          aria-label="Search or type a bottle"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {showTyped && (
        <>
          <div className={`${styles.row} ${styles.rowTyped}`}>
            <span
              className={styles.glyph}
              style={{ background: spiritVisual(typedGuess ?? 'other').tint }}
              aria-hidden
            >
              {spiritVisual(typedGuess ?? 'other').emoji}
            </span>
            <button className={styles.text} onClick={addTyped}>
              <span className={styles.label}>{q}</span>
              {typedUnlocks > 0 && (
                <span className={styles.unlock}>
                  unlocks {typedUnlocks} drink{typedUnlocks > 1 ? 's' : ''}
                </span>
              )}
            </button>
            <button
              className={styles.typeBtn}
              onClick={() => setPicking((v) => (v === TYPED ? null : TYPED))}
              aria-label="Change spirit category"
            >
              {typedGuess ? spiritVisual(typedGuess).label : 'Set type'}
            </button>
            <button className={styles.addBtn} onClick={addTyped} aria-label={`Add ${q}`}>
              Add
            </button>
          </div>
          {picking === TYPED &&
            categoryChips(typedGuess, (key) => {
              setTypedCategory(key)
              setPicking(null)
            })}
        </>
      )}

      {customPicks.map(([key, bottle]) => (
        <div key={key}>
          <div className={`${styles.row} ${styles.rowOn}`}>
            <span
              className={styles.glyph}
              style={{ background: spiritVisual(bottle.category ?? 'other').tint }}
              aria-hidden
            >
              {spiritVisual(bottle.category ?? 'other').emoji}
            </span>
            <span className={styles.text}>
              <span className={styles.label}>{bottle.label}</span>
            </span>
            <button
              className={styles.typeBtn}
              onClick={() => setPicking((v) => (v === key ? null : key))}
              aria-label={`Change spirit category for ${bottle.label}`}
            >
              {bottle.category ? spiritVisual(bottle.category).label : 'Set type'}
            </button>
            <button
              className={styles.remove}
              onClick={() => toggle(key, bottle)}
              aria-label={`Remove ${bottle.label}`}
            >
              ✕
            </button>
          </div>
          {picking === key &&
            categoryChips(bottle.category, (cat) => {
              setCategory(key, cat)
              setPicking(null)
            })}
        </div>
      ))}

      <div className={sheet.body}>
        {shown.length === 0 && !showTyped ? (
          <p className={sheet.hint}>
            {q ? 'Already on the shelf.' : 'Every bottle your recipes call for is already on the shelf.'}
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
