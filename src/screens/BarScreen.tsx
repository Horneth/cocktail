import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottleIcon, ChevronLeftIcon, PlusIcon, SearchIcon } from '../components/icons'
import { normIngredient } from '../domain/availability'
import { addToPantry, clearPantry, removeFromPantry, setInPantry } from '../domain/pantry'
import { useIngredientCatalog, usePantry } from '../hooks/useRecipes'
import { useAssumeStaples } from '../hooks/useSettings'
import styles from './BarScreen.module.css'

export function BarScreen() {
  const navigate = useNavigate()
  const { items, have } = usePantry()
  const catalog = useIngredientCatalog()
  const [assumeStaples, setAssumeStaples] = useAssumeStaples()
  const [query, setQuery] = useState('')

  // Merge the recipe-derived catalog with anything the user added by hand
  // (bottles that aren't in any recipe yet), deduped by normalized name.
  const rows = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of catalog) map.set(c.name, c.label)
    for (const it of items) if (!map.has(it.name)) map.set(it.name, it.label)
    const all = [...map.entries()].map(([name, label]) => ({ name, label }))
    const q = query.trim().toLowerCase()
    const filtered = q ? all.filter((r) => r.label.toLowerCase().includes(q)) : all
    // in-bar first, then alphabetical
    return filtered.sort((a, b) => {
      const ha = have.has(a.name) ? 0 : 1
      const hb = have.has(b.name) ? 0 : 1
      return ha - hb || a.label.localeCompare(b.label)
    })
  }, [catalog, items, have, query])

  const addCustom = () => {
    const label = query.trim()
    if (!label) return
    void addToPantry(label)
    setQuery('')
  }

  const exactExists = rows.some((r) => r.name === normIngredient(query))

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
        <div className={styles.intro}>
          <BottleIcon size={24} className={styles.introIcon} />
          <p>
            Tick the bottles you have. Then flip <strong>Only what I can make</strong> when browsing
            to see the drinks you can build right now.
          </p>
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

        <div className={styles.count}>
          {have.size} {have.size === 1 ? 'bottle' : 'bottles'} in your bar
          {have.size > 0 && (
            <button className={styles.clear} onClick={() => void clearPantry()}>
              Clear all
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <p className={styles.empty}>
            {query.trim() ? 'No matches — add it above.' : 'Import or add recipes to build your bottle list.'}
          </p>
        ) : (
          <ul className={styles.list}>
            {rows.map((r) => {
              const on = have.has(r.name)
              return (
                <li key={r.name}>
                  <label className={`${styles.item} ${on ? styles.itemOn : ''}`}>
                    <input
                      type="checkbox"
                      className={styles.check}
                      checked={on}
                      onChange={(e) =>
                        on ? void removeFromPantry(r.name) : void setInPantry(r.label, e.target.checked)
                      }
                    />
                    <span className={styles.itemName}>{r.label}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
