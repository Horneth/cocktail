import { useNavigate } from 'react-router-dom'
import { BottomSheet } from './BottomSheet'
import { ChevronRightIcon } from './icons'
import styles from './AddSheet.module.css'

interface Props {
  open: boolean
  onClose: () => void
}

/** The center-FAB action sheet: import, build by hand, or scan. */
export function AddSheet({ open, onClose }: Props) {
  const navigate = useNavigate()
  const go = (to: string) => {
    onClose()
    navigate(to)
  }

  return (
    <BottomSheet open={open} onClose={onClose} draggable>
      <h2 className={styles.title}>Add a cocktail</h2>
      <p className={styles.subtitle}>Import from anywhere, or build one by hand.</p>

      <button className={styles.accentOpt} onClick={() => go('/import')}>
        <span className={styles.accentIcon}>✨</span>
        <span className={styles.optBody}>
          <span className={styles.optTitleLight}>Import a recipe</span>
          <span className={styles.optSubLight}>Paste a link, video description, or text</span>
        </span>
        <ChevronRightIcon size={20} className={styles.accentChevron} />
      </button>

      <button className={styles.opt} onClick={() => go('/new')}>
        <span className={styles.optIcon}>✏️</span>
        <span className={styles.optBody}>
          <span className={styles.optTitle}>Build it manually</span>
          <span className={styles.optSub}>Add ingredients, steps &amp; a sub-recipe</span>
        </span>
        <ChevronRightIcon size={20} className={styles.chevron} />
      </button>

      <button className={styles.opt} onClick={() => go('/bar')}>
        <span className={styles.optIcon}>📷</span>
        <span className={styles.optBody}>
          <span className={styles.optTitle}>Scan a menu or shelf</span>
          <span className={styles.optSub}>Snap a photo — we read the rest</span>
        </span>
        <ChevronRightIcon size={20} className={styles.chevron} />
      </button>
    </BottomSheet>
  )
}
