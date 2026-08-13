import { useNavigate } from 'react-router-dom'
import { SearchIcon } from './icons'
import styles from './SearchLauncher.module.css'

/**
 * The way into search from a list screen — the same pill on Home and on Browse,
 * so "where do I type" has one answer wherever you are.
 *
 * Deliberately a button, not a field: there is exactly one live search input in
 * the app (the Search screen, which is also a tab), because two of them means two
 * search behaviours to keep in step. Browse's chips filter what's on screen;
 * this looks for something that isn't.
 */
export function SearchLauncher() {
  const navigate = useNavigate()
  return (
    <button className={styles.launcher} onClick={() => navigate('/search')}>
      <SearchIcon size={19} className={styles.icon} />
      <span className={styles.text}>Search drinks, spirits, ingredients</span>
    </button>
  )
}
