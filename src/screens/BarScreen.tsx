import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottleIcon, ChevronLeftIcon, PlusIcon, SearchIcon } from '../components/icons'
import { normIngredient } from '../domain/availability'
import { categoryForName } from '../domain/spiritCategory'
import { addToPantry, clearPantry, removeFromPantry, setInPantry } from '../domain/pantry'
import { spiritSortIndex, tileMeta } from '../domain/spirits'
import { useIngredientCatalog, usePantry } from '../hooks/useRecipes'
import { useAssumeStaples } from '../hooks/useSettings'
import styles from './BarScreen.module.css'

interface Row {
  name: string
  label: string
}
interface Group {
  key: string
  rows: Row[]
  stocked: number
}

export function BarScreen() {
  const navigate = useNavigate()
  const { items, have } = usePantry()
  const catalog = useIngredientCatalog()
  const [assumeStaples, setAssumeStaples] = useAssumeStaples()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Merge the recipe-derived catalog with anything the user added by hand
  // (bottles that aren't in any recipe yet), deduped by normalized name, then
  // filter by the search box.
  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, string>()
    for (const c of catalog) map.set(c.name, c.label)
    for (const it of items) if (!map.has(it.name)) map.set(it.name, it.label)
    const all = [...map.entries()].map(([name, label]) => ({ name, label }))
    const q = query.trim().toLowerCase()
    return q ? all.filter((r) => r.label.toLowerCase().includes(q)) : all
  }, [catalog, items, query])

  // Bucket bottles by inferred spirit category so the list reads as sections
  // (Gin, Whiskey, Liqueurs, …) instead of one long alphabetized wall.
  const groups = useMemo<Group[]>(() => {
    const byKey = new Map<string, Row[]>()
    for (const r of rows) {
      const key = categoryForName(r.label) ?? 'other'
      const g = byKey.get(key)
      if (g) g.push(r)
      else byKey.set(key, [r])
    }
    const out: Group[] = [...byKey.entries()].map(([key, rs]) => ({
      key,
      rows: rs.sort((a, b) => a.label.localeCompare(b.label)),
      stocked: rs.filter((r) => have.has(r.name)).length,
    }))
    // known spirits first (mosaic order), 'other' always last
    return out.sort((a, b) => {
      if (a.key === 'other') return 1
      if (b.key === 'other') return -1
      return spiritSortIndex(a.key) - spiritSortIndex(b.key) || a.key.localeCompare(b.key)
    })
  }, [rows, have])

  const searching = query.trim() !== ''

  // Summary reflects the whole bar, not the filtered view.
  const categoriesStocked = useMemo(
    () => new Set(items.map((i) => categoryForName(i.label) ?? 'other')).size,
    [items],
  )

  const addCustom = () => {
    const label = query.trim()
    if (!label) return
    void addToPantry(label)
    setQuery('')
  }

  const exactExists = rows.some((r) => r.name === normIngredient(query))

  const toggleCollapse = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button className={styles.iconBtn} aria-label="Back" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={26} />
        </button>
        <span className={styles.headTitle}>My Bar</span>
        <span className={styles.headSpacer} />
      </header>

      <div className={styles.body}>
        <div className={styles.summary}>
          <BottleIcon size={24} className={styles.summaryIcon} />
          {have.size > 0 ? (
            <div className={styles.summaryText}>
              <span className={styles.summaryCount}>
                {have.size} {have.size === 1 ? 'bottle' : 'bottles'} · {categoriesStocked}{' '}
                {categoriesStocked === 1 ? 'category' : 'categories'}
              </span>
              <span className={styles.summaryHint}>
                Flip <strong>Only what I can make</strong> when browsing to see what's ready.
              </span>
            </div>
          ) : (
            <div className={styles.summaryText}>
              <span className={styles.summaryCount}>Your bar is empty</span>
              <span className={styles.summaryHint}>
                Tick the bottles you have below to unlock “what I can make”.
              </span>
            </div>
          )}
          {have.size > 0 && (
            <button className={styles.clear} onClick={() => void clearPantry()}>
              Clear
            </button>
          )}
        </div>

        <label className={styles.staplesRow}>
          <span className={styles.staplesText}>
            <span className={styles.staplesTitle}>Assume I have the basics</span>
            <span className={styles.staplesHint}>water, ice, citrus, sugar, sodas, garnishes, egg</span>
          </span>
          <input
            type="checkbox"
            className={styles.switch}
            checked={assumeStaples}
            onChange={(e) => setAssumeStaples(e.target.checked)}
          />
        </label>

        <div className={styles.search}>
          <SearchIcon size={18} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or add a bottle…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>

        {query.trim() && !exactExists && (
          <button className={styles.addRow} onClick={addCustom}>
            <PlusIcon size={16} /> Add “{query.trim()}” to my bar
          </button>
        )}

        {rows.length === 0 ? (
          <p className={styles.empty}>
            {searching ? 'No matches — add it above.' : 'Import or add recipes to build your bottle list.'}
          </p>
        ) : (
          groups.map((g) => {
            const meta = tileMeta(g.key)
            const isCollapsed = !searching && collapsed.has(g.key)
            return (
              <section key={g.key} className={styles.group}>
                <button className={styles.groupHead} onClick={() => toggleCollapse(g.key)}>
                  <span className={styles.groupEmoji}>{meta.emoji}</span>
                  <span className={styles.groupLabel}>{meta.label}</span>
                  <span className={styles.groupCount}>
                    {g.stocked} of {g.rows.length}
                  </span>
                  <span className={styles.groupChevron} aria-hidden>
                    {isCollapsed ? '▸' : '▾'}
                  </span>
                </button>
                {!isCollapsed && (
                  <ul className={styles.list}>
                    {g.rows.map((r) => {
                      const on = have.has(r.name)
                      return (
                        <li key={r.name}>
                          <label className={`${styles.item} ${on ? styles.itemOn : ''}`}>
                            <input
                              type="checkbox"
                              className={styles.check}
                              checked={on}
                              onChange={(e) =>
                                on
                                  ? void removeFromPantry(r.name)
                                  : void setInPantry(r.label, e.target.checked)
                              }
                            />
                            <span className={styles.itemName}>{r.label}</span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            )
          })
        )}
      </div>
    </div>
  )
}
