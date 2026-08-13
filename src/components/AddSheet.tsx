import { useNavigate } from 'react-router-dom'
import { BottomSheet } from './BottomSheet'
import { ChevronRightIcon } from './icons'
import { FEATURES, isCloudAIConfigured } from '../config'
import styles from './AddSheet.module.css'

// Read the config directly rather than through `useAuth`: this sheet renders on
// every screen, and it only needs to know whether the build has AI at all — not
// who is signed in. The sign-in prompts live where the feature does.
const aiInBuild = FEATURES.cloudAI && isCloudAIConfigured()

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * The one place anything gets added — a recipe or a bottle. The Bar screen used
 * to carry its own "Add a bottle" and "Scan my shelf" buttons next to this FAB;
 * three adds on one screen is a question ("which add is this?") the user
 * shouldn't have to answer. The bottle rows hand off to My Bar through a query
 * param, so the sheet stays a menu and the bar keeps its own machinery.
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

      {aiInBuild && (
        <button className={styles.accentOpt} onClick={() => go('/import')}>
          <span className={styles.accentIcon}>✨</span>
          <span className={styles.optTitleLight}>Import a recipe</span>
          <ChevronRightIcon size={20} className={styles.accentChevron} />
        </button>
      )}

      <button className={styles.opt} onClick={() => go('/new')}>
        <span className={styles.optIcon}>✏️</span>
        <span className={styles.optTitle}>Build a recipe</span>
        <ChevronRightIcon size={20} className={styles.chevron} />
      </button>

      <button className={styles.opt} onClick={() => go('/bar?add=1')}>
        <span className={styles.optIcon}>🍾</span>
        <span className={styles.optTitle}>Add a bottle</span>
        <ChevronRightIcon size={20} className={styles.chevron} />
      </button>

      {aiInBuild && (
        <button className={styles.opt} onClick={() => go('/bar?scan=1')}>
          <span className={styles.optIcon}>📷</span>
          <span className={styles.optTitle}>Scan my shelf</span>
          <ChevronRightIcon size={20} className={styles.chevron} />
        </button>
      )}
    </BottomSheet>
  )
}
