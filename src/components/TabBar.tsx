import { useNavigate } from 'react-router-dom'
import { BottleIcon, GearIcon, PlusIcon } from './icons'
import styles from './TabBar.module.css'

export type Tab = 'recipes' | 'bar' | 'settings'

interface Props {
  active: Tab
}

function RecipesIcon({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h14M7 4v16M17 4v16M5 20h14M7 8h10M7 12h10M7 16h6" /></svg>
}

export function TabBar({ active }: Props) {
  const navigate = useNavigate()
  const tab = (key: Tab, label: string, to: string, glyph: React.ReactNode) => (
    <button className={`${styles.tab} ${active === key ? styles.tabOn : ''}`} onClick={() => navigate(to)} aria-label={label} aria-current={active === key ? 'page' : undefined}>
      {glyph}<span className={styles.tabLabel}>{label}</span>
    </button>
  )
  return <div className={styles.wrap}><div className={styles.bar}>
    {tab('recipes', 'Recipes', '/', <RecipesIcon />)}
    {tab('bar', 'My Bar', '/bar', <BottleIcon size={21} />)}
    {tab('settings', 'Settings', '/settings', <GearIcon size={21} />)}
  </div></div>
}

export function AccentButton({ label, onClick, to }: { label: string; onClick?: () => void; to?: string }) {
  const navigate = useNavigate()
  const content = <><PlusIcon size={16} />{label}</>
  if (to) return <button className={styles.accent} onClick={() => navigate(to)}>{content}</button>
  return <button className={styles.accent} onClick={onClick}>{content}</button>
}
