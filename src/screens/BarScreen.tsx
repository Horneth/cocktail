import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { PlusIcon, SearchIcon } from '../components/icons'
import { FEATURES } from '../config'
import { normIngredient } from '../domain/availability'
import { categoryForName } from '../domain/spiritCategory'
import { createBar, deleteBar, renameBar } from '../domain/bars'
import { addToPantry, bulkAddPantry, removeFromPantry, setInPantry } from '../domain/pantry'
import { spiritSortIndex } from '../domain/spirits'
import { spiritVisual } from '../domain/spiritVisual'
import { GeminiError, geminiIdentifyBottles, type IdentifiedBottle } from '../import/gemini'
import { downscaleDataUrl } from '../import/image'
import { useIngredientCatalog, usePantry } from '../hooks/useRecipes'
import { useAvailability } from '../hooks/useAvailability'
import { useAssumeStaples, useGeminiSettings } from '../hooks/useSettings'
import styles from './BarScreen.module.css'

const MAX_SCAN_IMAGES = 4

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
  const { barId, bars, setBarId, makeableCount } = useAvailability()
  const { items, have } = usePantry(barId)
  const catalog = useIngredientCatalog()
  const gemini = useGeminiSettings()
  const [assumeStaples, setAssumeStaples] = useAssumeStaples()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const fileRef = useRef<HTMLInputElement>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scanResults, setScanResults] = useState<IdentifiedBottle[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, string>()
    for (const c of catalog) map.set(c.name, c.label)
    for (const it of items) if (!map.has(it.name)) map.set(it.name, it.label)
    const all = [...map.entries()].map(([name, label]) => ({ name, label }))
    const q = query.trim().toLowerCase()
    return q ? all.filter((r) => r.label.toLowerCase().includes(q)) : all
  }, [catalog, items, query])

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
    return out.sort((a, b) => {
      if (a.key === 'other') return 1
      if (b.key === 'other') return -1
      return spiritSortIndex(a.key) - spiritSortIndex(b.key) || a.key.localeCompare(b.key)
    })
  }, [rows, have])

  const searching = query.trim() !== ''
  const totalCount = rows.length
  const activeBar = bars.find((b) => b.id === barId)

  const addCustom = () => {
    const label = query.trim()
    if (!label || !barId) return
    void addToPantry(barId, label)
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

  const onNewBar = async () => {
    const name = window.prompt('Name this bar (e.g. “Beach house”)')?.trim()
    if (!name) return
    setBarId(await createBar(name))
  }
  const onRenameBar = async () => {
    if (!barId) return
    const name = window.prompt('Rename bar', activeBar?.name ?? '')?.trim()
    if (name) await renameBar(barId, name)
  }
  const onDeleteBar = async () => {
    if (!barId || bars.length <= 1) return
    if (!window.confirm(`Delete “${activeBar?.name}” and its bottles?`)) return
    const remaining = bars.find((b) => b.id !== barId)
    try {
      await deleteBar(barId)
      if (remaining) setBarId(remaining.id)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not delete this bar.')
    }
  }

  const scanEnabled = FEATURES.cloudAI && gemini.hasKey
  const onScanFiles = async (files: FileList | null) => {
    if (!files || !files.length) return
    setScanBusy(true)
    setScanError(null)
    try {
      const chosen = [...files].slice(0, MAX_SCAN_IMAGES)
      const images = await Promise.all(chosen.map((f) => downscaleDataUrl(f)))
      const bottles = await geminiIdentifyBottles(images, gemini.apiKey, gemini.model)
      setScanResults(bottles)
      setPicked(new Set(bottles.map((b) => b.name)))
    } catch (err) {
      setScanError(err instanceof GeminiError ? err.message : 'Could not scan those photos.')
    } finally {
      setScanBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  const togglePick = (name: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  const confirmScan = async () => {
    if (!barId || !scanResults) return
    const names = scanResults.filter((b) => picked.has(b.name)).map((b) => b.name)
    if (names.length) await bulkAddPantry(barId, names)
    setScanResults(null)
    setPicked(new Set())
  }

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div className={styles.count}>
          {have.size} of {totalCount} ingredients
        </div>
        <h1 className={styles.title}>My Bar</h1>
      </div>

      <div className={styles.summary}>
        <div className={styles.summaryNum}>{makeableCount}</div>
        <div className={styles.summaryText}>
          drinks unlocked
          <span className={styles.summaryHint}>Tick a bottle to unlock more</span>
        </div>
        <button
          className={styles.summaryBtn}
          onClick={() => navigate(makeableCount > 0 ? '/browse?makeable=1' : '/browse')}
        >
          View
        </button>
      </div>

      <div className={styles.barRow}>
        <select
          className={styles.barSelect}
          value={barId ?? ''}
          onChange={(e) => setBarId(e.target.value)}
          aria-label="Active bar"
        >
          {bars.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <button className={styles.barAction} onClick={() => void onNewBar()}>
          New
        </button>
        <button className={styles.barAction} onClick={() => void onRenameBar()}>
          Rename
        </button>
        {bars.length > 1 && (
          <button className={styles.barActionDanger} onClick={() => void onDeleteBar()}>
            Delete
          </button>
        )}
      </div>

      <label className={styles.staples}>
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
          <PlusIcon size={16} /> Add “{query.trim()}” to {activeBar?.name ?? 'my bar'}
        </button>
      )}

      {scanEnabled && (
        <button className={styles.scanRow} onClick={() => fileRef.current?.click()} disabled={scanBusy}>
          📷 {scanBusy ? 'Scanning your shelf…' : 'Scan my shelf'}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => void onScanFiles(e.target.files)}
      />
      {scanError && <p className={styles.scanError}>{scanError}</p>}

      {rows.length === 0 ? (
        <p className={styles.empty}>
          {searching ? 'No matches — add it above.' : 'Import or add recipes to build your bottle list.'}
        </p>
      ) : (
        groups.map((g) => {
          const v = spiritVisual(g.key)
          const isCollapsed = !searching && collapsed.has(g.key)
          return (
            <section key={g.key} className={styles.group}>
              <button className={styles.groupHead} onClick={() => toggleCollapse(g.key)}>
                <span className={styles.groupEmoji} style={{ background: v.tint }}>
                  {v.emoji}
                </span>
                <span className={styles.groupLabel}>{v.label}</span>
                <span className={styles.groupCount}>
                  {g.stocked}/{g.rows.length}
                </span>
                <span className={styles.groupChevron} aria-hidden>
                  {isCollapsed ? '▸' : '▾'}
                </span>
              </button>
              {!isCollapsed && (
                <div className={styles.items}>
                  {g.rows.map((r) => {
                    const on = have.has(r.name)
                    return (
                      <button
                        key={r.name}
                        className={`${styles.item} ${on ? styles.itemOn : styles.itemOff}`}
                        disabled={!barId}
                        onClick={() =>
                          barId &&
                          (on ? void removeFromPantry(barId, r.name) : void setInPantry(barId, r.label, true))
                        }
                      >
                        <span className={styles.itemName}>{r.label}</span>
                        <span className={`${styles.check} ${on ? styles.checkOn : styles.checkOff}`}>
                          {on ? '✓' : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })
      )}

      <BottomSheet open={!!scanResults} onClose={() => setScanResults(null)}>
        {scanResults && (
          <>
            <h2 className={styles.sheetTitle}>
              {scanResults.length
                ? `Found ${scanResults.length} bottle${scanResults.length > 1 ? 's' : ''}`
                : 'No bottles found'}
            </h2>
            {scanResults.length === 0 ? (
              <p className={styles.sheetHint}>Try a clearer, closer photo of the labels.</p>
            ) : (
              <div className={`${styles.items} ${styles.sheetList}`}>
                {scanResults.map((b) => {
                  const on = picked.has(b.name)
                  const already = have.has(normIngredient(b.name))
                  return (
                    <button
                      key={b.name}
                      className={`${styles.item} ${on ? styles.itemOn : styles.itemOff}`}
                      onClick={() => togglePick(b.name)}
                    >
                      <span className={styles.itemName}>
                        {b.name}
                        {already && <span className={styles.sheetTag}>in bar</span>}
                      </span>
                      <span className={`${styles.check} ${on ? styles.checkOn : styles.checkOff}`}>
                        {on ? '✓' : ''}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className={styles.sheetActions}>
              <button className={styles.sheetGhost} onClick={() => setScanResults(null)}>
                Cancel
              </button>
              {scanResults.length > 0 && (
                <button className={styles.sheetSolid} disabled={picked.size === 0} onClick={() => void confirmScan()}>
                  Add {picked.size} to {activeBar?.name ?? 'bar'}
                </button>
              )}
            </div>
          </>
        )}
      </BottomSheet>
    </div>
  )
}
