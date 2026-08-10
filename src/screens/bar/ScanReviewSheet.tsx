import { useEffect, useMemo, useState } from 'react'
import { BottomSheet } from '../../components/BottomSheet'
import { CheckIcon } from '../../components/icons'
import type { Recipe } from '../../db/schema'
import { unlocksFor } from '../../domain/barInsights'
import type { ResolvedBottle } from '../../domain/bottleMatch'
import type { BottleInput } from '../../domain/pantry'
import { spiritSortIndex } from '../../domain/spirits'
import { spiritVisual } from '../../domain/spiritVisual'
import type { IdentifiedBottle } from '../../import/aiShared'
import sheet from './sheet.module.css'
import styles from './ScanReviewSheet.module.css'

export type ScanResult = ResolvedBottle<IdentifiedBottle>

interface Props {
  results: ScanResult[] | null
  onClose: () => void
  onAdd: (bottles: BottleInput[]) => void
  barName: string
  have: Set<string>
  cocktails: Recipe[]
  byId: Map<string, Recipe>
  assumeStaples: boolean
}

/**
 * Which bottles start ticked. Only confidently-new ones: a bottle the user
 * already has, a near-variant, or a label the model could barely read are all
 * decisions worth a deliberate tap rather than an undo.
 */
function defaultPicks(results: ScanResult[]): Set<string> {
  return new Set(
    results
      .filter((r) => r.verdict === 'new' && r.detected.confidence !== 'low')
      .map((r) => r.canonicalName),
  )
}

function toBottle(r: ScanResult): BottleInput {
  return {
    label: r.canonicalName,
    ...(r.detected.category ? { category: r.detected.category } : {}),
    ...(r.detected.brand ? { brand: r.detected.brand } : {}),
  }
}

export function ScanReviewSheet({
  results,
  onClose,
  onAdd,
  barName,
  have,
  cocktails,
  byId,
  assumeStaples,
}: Props) {
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (results) setPicked(defaultPicks(results))
  }, [results])

  // Grouped by spirit family so a shelf of twelve bottles reads as four groups.
  const groups = useMemo(() => {
    const byKey = new Map<string, ScanResult[]>()
    for (const r of results ?? []) {
      const key = r.detected.category ?? 'other'
      const group = byKey.get(key)
      if (group) group.push(r)
      else byKey.set(key, [r])
    }
    return [...byKey.entries()].sort(([a], [b]) => {
      if (a === 'other') return 1
      if (b === 'other') return -1
      return spiritSortIndex(a) - spiritSortIndex(b) || a.localeCompare(b)
    })
  }, [results])

  const chosen = useMemo(
    () => (results ?? []).filter((r) => picked.has(r.canonicalName)),
    [results, picked],
  )
  const total = useMemo(
    () =>
      chosen.length
        ? unlocksFor(chosen.map((r) => r.canonicalName), cocktails, byId, have, assumeStaples).unlocks
        : 0,
    [chosen, cocktails, byId, have, assumeStaples],
  )

  const found = results?.length ?? 0
  const fresh = (results ?? []).filter((r) => r.verdict === 'new').length

  const toggle = (key: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <BottomSheet open={!!results} onClose={onClose}>
      {results && (
        <>
          <div className={sheet.head}>
            <h2 className={sheet.title}>
              {found ? `Found ${found} bottle${found > 1 ? 's' : ''}` : 'No bottles found'}
            </h2>
            <p className={sheet.subtitle}>
              {found
                ? `${fresh} new to ${barName}. Tap to change what gets added.`
                : 'Try a clearer, closer photo of the labels.'}
            </p>
          </div>

          <div className={sheet.body}>
            {groups.map(([key, rows]) => {
              const v = spiritVisual(key)
              return (
                <section key={key} className={styles.group}>
                  <p className={styles.groupHead}>
                    <span className={styles.groupGlyph} style={{ background: v.tint }} aria-hidden>
                      {v.emoji}
                    </span>
                    {v.label}
                  </p>
                  {rows.map((r) => {
                    const on = picked.has(r.canonicalName)
                    const already = r.verdict === 'same'
                    return (
                      <button
                        key={r.canonicalName}
                        className={`${styles.row} ${on ? styles.rowOn : ''} ${already ? styles.rowMuted : ''}`}
                        onClick={() => toggle(r.canonicalName)}
                      >
                        <span className={styles.text}>
                          <span className={styles.name}>{r.canonicalName}</span>
                          {r.match && (
                            <span className={styles.note}>
                              {already ? 'already on your shelf as ' : 'looks like your '}
                              <b>{r.match}</b>
                            </span>
                          )}
                        </span>
                        <span
                          className={`${sheet.pill} ${
                            already
                              ? sheet.pillMuted
                              : r.verdict === 'variant' || r.detected.confidence === 'low'
                                ? sheet.pillWarn
                                : sheet.pillReady
                          }`}
                        >
                          {already
                            ? 'In bar'
                            : r.verdict === 'variant'
                              ? 'Variant'
                              : r.detected.confidence === 'low'
                                ? 'Not sure'
                                : 'New'}
                        </span>
                        <span className={`${styles.tick} ${on ? styles.tickOn : ''}`}>
                          {on && <CheckIcon size={14} />}
                        </span>
                      </button>
                    )
                  })}
                </section>
              )
            })}
          </div>

          <div className={sheet.actions}>
            <button className={sheet.ghost} onClick={onClose}>
              Cancel
            </button>
            <button
              className={sheet.solid}
              disabled={chosen.length === 0}
              onClick={() => onAdd(chosen.map(toBottle))}
            >
              <span>
                Add {chosen.length || ''} to {barName}
              </span>
              {total > 0 && (
                <span className={sheet.solidSub}>
                  unlocks {total} drink{total > 1 ? 's' : ''}
                </span>
              )}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
