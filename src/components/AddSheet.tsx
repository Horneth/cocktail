import { useNavigate } from 'react-router-dom'
import { BottomSheet } from './BottomSheet'
import { ChevronRightIcon } from './icons'
import styles from './AddSheet.module.css'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * The one place anything gets added — a recipe or a bottle. There used to be
 * four rows here ("Import a recipe", "Build a recipe", "Add a bottle", "Scan my
 * shelf") that split each add into a manual and an AI flavour with different
 * names. Now it's simply "what am I adding?", and the AI — paste-to-fill for a
 * recipe, photo scan for bottles — lives inside the two editors it augments.
 */
export function AddSheet({ open, onClose }: Props) {
  const navigate = useNavigate()
  const go = (to: string) => {
    onClose()
    navigate(to)
  }

  return (
    <BottomSheet open={open} onClose={onClose} draggable>
      <h2 className={styles.title}>Add</h2>

      <button className={styles.opt} onClick={() => go('/new')}>
        <span className={styles.optIcon}>🍸</span>
        <span className={styles.optTitle}>A recipe</span>
        <ChevronRightIcon size={20} className={styles.chevron} />
      </button>

      <button className={styles.opt} onClick={() => go('/bar?add=1')}>
        <span className={styles.optIcon}>🍾</span>
        <span className={styles.optTitle}>A bottle</span>
        <ChevronRightIcon size={20} className={styles.chevron} />
      </button>
    </BottomSheet>
  )
}