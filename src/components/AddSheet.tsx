import { useNavigate } from 'react-router-dom'
import { BottomSheet } from './BottomSheet'
import { ChevronRightIcon } from './icons'
import { FEATURES, isCloudAIConfigured } from '../config'
import styles from './AddSheet.module.css'

// Read the config directly rather than through `useAuth`: this sheet renders on
// every screen, and it only needs to know whether the build has AI at all — not
// who is signed in. The sign-in prompt itself lives on the import screen.
const importAvailable = FEATURES.cloudAI && isCloudAIConfigured()

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

      {importAvailable && (
        <button className={styles.accentOpt} onClick={() => go('/import')}>
          <span className={styles.accentIcon}>✨</span>
          <span className={styles.optTitleLight}>Import a recipe</span>
          <ChevronRightIcon size={20} className={styles.accentChevron} />
        </button>
      )}

      <button className={styles.opt} onClick={() => go('/new')}>
        <span className={styles.optIcon}>✏️</span>
        <span className={styles.optTitle}>Build it manually</span>
        <ChevronRightIcon size={20} className={styles.chevron} />
      </button>

      <button className={styles.opt} onClick={() => go('/bar')}>
        <span className={styles.optIcon}>📷</span>
        <span className={styles.optTitle}>Scan my shelf</span>
        <ChevronRightIcon size={20} className={styles.chevron} />
      </button>
    </BottomSheet>
  )
}
