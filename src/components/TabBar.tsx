import { useNavigate } from 'react-router-dom'
import { BottleIcon, PlusIcon, SearchIcon } from './icons'
import styles from './TabBar.module.css'

export type Tab = 'home' | 'search' | 'browse' | 'bar'

interface Props {
  active: Tab
  onAdd: () => void
}

function HomeGlyph({ size = 23 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  )
}

function BrowseGlyph({ size = 23 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
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
        {tab('home', 'Home', '/', <HomeGlyph />)}
        {tab('search', 'Search', '/search', <SearchIcon size={22} />)}
        <button className={styles.fab} aria-label="Add" onClick={onAdd}>
          <PlusIcon size={27} />
        </button>
        {tab('browse', 'Browse', '/browse', <BrowseGlyph />)}
        {tab('bar', 'My Bar', '/bar', <BottleIcon size={22} />)}
      </div>
    </div>
  )
}
