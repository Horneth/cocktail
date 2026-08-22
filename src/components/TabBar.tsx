import { useNavigate } from 'react-router-dom'
import { BottleIcon, PlusIcon } from './icons'
import styles from './TabBar.module.css'

export type Tab = 'recipes' | 'bar'

interface Props {
  active: Tab
  onAdd: () => void
}

/** Two product surfaces — recipes and your bar — with one add-FAB between them. */
function CocktailGlyph({ size = 23 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 3h14l-6 9v7M7 21h10" />
      <path d="M7 3h12" />
    </svg>
  )
}

/** Persistent bottom navigation with a centered add-FAB. */
export function TabBar({ active, onAdd }: Props) {
  const navigate = useNavigate()

  const tab = (key: Tab, label: string, to: string, glyph: React.ReactNode) => (
    <button
      className={`${styles.tab} ${active === key ? styles.tabOn : ''}`}
      onClick={() => navigate(to)}
      aria-label={label}
      aria-current={active === key ? 'page' : undefined}
    >
      {glyph}
      <span className={styles.tabLabel}>{label}</span>
    </button>
  )

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        {tab('recipes', 'Recipes', '/', <CocktailGlyph />)}
        <span className={styles.fabSpacer} />
        <button className={styles.fab} aria-label="Add" onClick={onAdd}>
          <PlusIcon size={27} />
        </button>
        <span className={styles.fabSpacer} />
        {tab('bar', 'My Bar', '/bar', <BottleIcon size={22} />)}
      </div>
    </div>
  )
}