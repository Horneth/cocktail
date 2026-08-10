import { useEffect, useRef, useState } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { CheckIcon, EditIcon, PlusIcon, TrashIcon } from '../../components/icons'
import { createBar, deleteBar, renameBar } from '../../domain/bars'
import type { Bar } from '../../db/schema'
import sheet from './sheet.module.css'
import styles from './ManageBarsSheet.module.css'

interface Props {
  open: boolean
  onClose: () => void
  bars: Bar[]
  activeId: string | undefined
  onSelect: (id: string) => void
  /** bottle count per bar id, for the row subtitle */
  counts: Map<string, number>
}

// Which row (if any) has taken over the sheet. Only one at a time: an inline
// input or a delete confirm replaces the row it belongs to, so the sheet never
// stacks a dialog on a dialog — that was the problem with window.prompt.
type Mode =
  | { kind: 'list' }
  | { kind: 'rename'; id: string }
  | { kind: 'confirm'; id: string }
  | { kind: 'create' }

/**
 * Switch, rename, create and delete bars. Replaces the old `<select>` + three
 * pill buttons, and with them every `window.prompt`/`confirm`/`alert` in the app.
 */
export function ManageBarsSheet({ open, onClose, bars, activeId, onSelect, counts }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: 'list' })
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reopening should always land on the plain list, never on someone's
  // half-finished rename from last time.
  useEffect(() => {
    if (!open) return
    setMode({ kind: 'list' })
    setDraft('')
    setError(null)
  }, [open])

  useEffect(() => {
    if (mode.kind === 'rename' || mode.kind === 'create') inputRef.current?.focus()
  }, [mode])

  const startRename = (bar: Bar) => {
    setError(null)
    setDraft(bar.name)
    setMode({ kind: 'rename', id: bar.id })
  }
  const startCreate = () => {
    setError(null)
    setDraft('')
    setMode({ kind: 'create' })
  }
  const cancel = () => {
    setMode({ kind: 'list' })
    setDraft('')
  }

  const commit = async () => {
    const name = draft.trim()
    if (!name) return cancel()
    if (mode.kind === 'rename') await renameBar(mode.id, name)
    else if (mode.kind === 'create') onSelect(await createBar(name))
    cancel()
  }

  const confirmDelete = async (id: string) => {
    try {
      // Pick the survivor before the delete, so switching away can't race the
      // live query that is about to drop this bar from the list.
      const remaining = bars.find((b) => b.id !== id)
      await deleteBar(id)
      if (id === activeId && remaining) onSelect(remaining.id)
      cancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete this bar.')
      setMode({ kind: 'list' })
    }
  }

  const nameField = (label: string) => (
    <div className={styles.editRow}>
      <input
        ref={inputRef}
        className={styles.input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
          if (e.key === 'Escape') cancel()
        }}
        placeholder="Beach house"
        aria-label={label}
        autoComplete="off"
      />
      <button className={styles.editCancel} onClick={cancel}>
        Cancel
      </button>
      <button className={styles.editSave} onClick={() => void commit()} disabled={!draft.trim()}>
        Save
      </button>
    </div>
  )

  return (
    <BottomSheet open={open} onClose={onClose} draggable>
      <div className={sheet.head}>
        <h2 className={sheet.title}>Your bars</h2>
        <p className={sheet.subtitle}>Keep a separate shelf for a friend’s place or a trip.</p>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={sheet.body}>
        {bars.map((bar) => {
          if (mode.kind === 'rename' && mode.id === bar.id) return <div key={bar.id}>{nameField('Bar name')}</div>

          if (mode.kind === 'confirm' && mode.id === bar.id) {
            const count = counts.get(bar.id) ?? 0
            return (
              <div key={bar.id} className={styles.confirm}>
                <span className={styles.confirmText}>
                  Delete “{bar.name}”{count > 0 && ` and its ${count} bottle${count > 1 ? 's' : ''}`}?
                </span>
                <button className={styles.editCancel} onClick={cancel}>
                  Keep
                </button>
                <button className={styles.confirmGo} onClick={() => void confirmDelete(bar.id)}>
                  Delete
                </button>
              </div>
            )
          }

          const active = bar.id === activeId
          const count = counts.get(bar.id) ?? 0
          return (
            <div key={bar.id} className={`${styles.row} ${active ? styles.rowOn : ''}`}>
              <button
                className={styles.pick}
                onClick={() => {
                  onSelect(bar.id)
                  onClose()
                }}
              >
                <span className={styles.name}>{bar.name}</span>
                <span className={styles.count}>
                  {count} bottle{count === 1 ? '' : 's'}
                </span>
              </button>
              {active && <CheckIcon size={18} className={styles.tick} />}
              <button className={styles.iconBtn} aria-label={`Rename ${bar.name}`} onClick={() => startRename(bar)}>
                <EditIcon size={17} />
              </button>
              {bars.length > 1 && (
                <button
                  className={styles.iconBtn}
                  aria-label={`Delete ${bar.name}`}
                  onClick={() => {
                    setError(null)
                    setMode({ kind: 'confirm', id: bar.id })
                  }}
                >
                  <TrashIcon size={17} />
                </button>
              )}
            </div>
          )
        })}

        {mode.kind === 'create' ? (
          nameField('New bar name')
        ) : (
          <button className={styles.addRow} onClick={startCreate}>
            <PlusIcon size={17} /> New bar
          </button>
        )}
      </div>
    </BottomSheet>
  )
}
