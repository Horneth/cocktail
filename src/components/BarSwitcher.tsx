import type { Bar } from '../db/schema'
import { BottleIcon } from './icons'
import styles from './BarSwitcher.module.css'

/**
 * Compact active-bar picker for screens that show "what I can make" (Home,
 * Browse). Presentational on purpose: the parent owns the `useActiveBar()`
 * instance and passes state down, so switching here updates the SAME hook the
 * screen's `usePantry` reads — the makeable count/list refresh live. Renders
 * nothing when there's only one bar (nothing to switch).
 */
export function BarSwitcher({
  bars,
  barId,
  onChange,
  className,
}: {
  bars: Bar[]
  barId: string | undefined
  onChange: (id: string) => void
  className?: string
}) {
  if (bars.length <= 1) return null
  return (
    <label className={`${styles.wrap} ${className ?? ''}`}>
      <BottleIcon size={15} className={styles.icon} />
      <select
        className={styles.select}
        value={barId ?? ''}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Active bar"
      >
        {bars.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  )
}
