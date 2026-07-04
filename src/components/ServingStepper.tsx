import { MinusIcon, PlusIcon } from './icons'
import styles from './ServingStepper.module.css'

// Multiplier ladder — the tap targets step through sensible batch sizes.
const LADDER = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12]

function nextMultiplier(current: number, dir: 1 | -1): number {
  // find closest ladder index, then step
  let idx = 0
  let best = Infinity
  for (let i = 0; i < LADDER.length; i++) {
    const d = Math.abs(LADDER[i] - current)
    if (d < best) {
      best = d
      idx = i
    }
  }
  const next = Math.min(Math.max(idx + dir, 0), LADDER.length - 1)
  return LADDER[next]
}

interface Props {
  multiplier: number
  onChange: (m: number) => void
  baseServings: number
}

export function ServingStepper({ multiplier, onChange, baseServings }: Props) {
  const servings = Math.round(baseServings * multiplier * 100) / 100
  const label = multiplier === 1 ? '1×' : `${trim(multiplier)}×`

  return (
    <div className={styles.wrap}>
      <button
        className={styles.btn}
        aria-label="Fewer"
        disabled={multiplier <= LADDER[0]}
        onClick={() => onChange(nextMultiplier(multiplier, -1))}
      >
        <MinusIcon size={22} />
      </button>
      <div className={styles.center}>
        <span className={styles.value}>{label}</span>
        <span className={styles.sub}>
          makes {trim(servings)} {servings === 1 ? 'drink' : 'drinks'}
        </span>
      </div>
      <button
        className={styles.btn}
        aria-label="More"
        disabled={multiplier >= LADDER[LADDER.length - 1]}
        onClick={() => onChange(nextMultiplier(multiplier, 1))}
      >
        <PlusIcon size={22} />
      </button>
    </div>
  )
}

function trim(n: number): string {
  return String(Number(n.toFixed(2)))
}
