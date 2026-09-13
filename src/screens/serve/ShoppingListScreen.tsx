import { Link } from 'react-router-dom'
import { ChevronLeftIcon } from '../../components/icons'
import { needsFor } from '../../domain/lineup'
import { categoryForName } from '../../domain/spiritCategory'
import { useServe } from '../../hooks/useServe'
import styles from './ShoppingListScreen.module.css'

const GROUPS = [
  { key: 'alcohol', label: 'Alcohol' },
  { key: 'juice', label: 'Juices & syrups' },
  { key: 'garnish', label: 'Garnishes' },
] as const

const GARNISH_RE = /\b(peel|twist|wheel|wedge|slice|zest|sprig|leaf|leaves|garnish|rind|dust|grated|shaved|cherry|olive)\b/i

function groupFor(name: string): (typeof GROUPS)[number]['key'] {
  if (GARNISH_RE.test(name)) return 'garnish'
  const category = categoryForName(name)
  if (category && category !== 'syrup' && category !== 'mocktail') return 'alcohol'
  return 'juice'
}

export function ShoppingListScreen() {
  const serve = useServe()
  const needs = needsFor(serve.menu, serve.have)
  const groups = GROUPS.map((group) => ({
    ...group,
    items: needs.filter((item) => groupFor(item.label) === group.key),
  })).filter((group) => group.items.length > 0)

  if (!serve.loaded) return null

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <Link className={styles.back} to="/serve" aria-label="Back to Pour">
          <ChevronLeftIcon size={18} />
          <span>Pour a round</span>
        </Link>
        <h1 className={styles.title}>Shopping list</h1>
        <p className={styles.context}>{serve.menu.length} selected drink{serve.menu.length === 1 ? '' : 's'}</p>
      </header>

      {serve.menu.length === 0 ? (
        <div className={styles.empty}>
          <h2>Your menu is empty</h2>
          <p>Add drinks in Pour and their ingredients will appear here.</p>
          <Link className={styles.return} to="/serve">Choose drinks</Link>
        </div>
      ) : groups.length === 0 ? (
        <div className={styles.empty}>
          <h2>Nothing to buy</h2>
          <p>Everything selected is already in {serve.barName}.</p>
        </div>
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => (
            <section key={group.key} className={styles.group}>
              <h2>{group.label}</h2>
              <div className={styles.items}>
                {group.items.map((item) => (
                  item.stocked ? (
                    <div key={item.key} className={styles.item}>
                      <span className={styles.mark}>✓</span>
                      <span>{item.label}</span>
                      <span className={styles.inBar}>In bar</span>
                    </div>
                  ) : (
                    <button
                      key={item.key}
                      className={`${styles.item} ${styles.missing}`}
                      aria-label={`Add ${item.label}`}
                      onClick={() => void serve.addToBar(item.label, categoryForName(item.label))}
                    >
                      <span className={styles.mark}>+</span>
                      <span>{item.label}</span>
                      <span className={styles.add}>Add to bar</span>
                    </button>
                  )
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
