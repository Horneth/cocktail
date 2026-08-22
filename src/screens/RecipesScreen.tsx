import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AccentButton } from '../components/TabBar'
import { ChevronDownIcon, SearchIcon, SparkleIcon } from '../components/icons'
import { makeableIds } from '../domain/availability'
import { recipesUsingBottle } from '../domain/barInsights'
import { matchesQuery } from '../domain/search'
import { SPIRIT_ORDER, tileKeyForRecipe, tileMeta } from '../domain/spirits'
import { useCocktails, useBottleCounts } from '../hooks/useRecipes'
import { useAvailability } from '../hooks/useAvailability'
import { ManageBarsSheet } from './bar/ManageBarsSheet'
import styles from './RecipesScreen.module.css'

export function RecipesScreen() {
  const cocktails = useCocktails() ?? []
  const { byId, have, assumeStaples, barId, bars, setBarId } = useAvailability()
  const counts = useBottleCounts()
  const [params, setParams] = useSearchParams()
  const [managingBars, setManagingBars] = useState(false)
  const q = (params.get('q') ?? '').trim()
  const scope = params.get('scope') || (params.get('makeable') === '1' ? 'ready' : 'all')
  const ingredient = params.get('ingredient') || ''
  const family = params.get('family') || undefined
  const barName = bars.find((b) => b.id === barId)?.name ?? 'Home bar'

  const scopes = useMemo(() => {
    const keys = new Set(cocktails.map(tileKeyForRecipe))
    return ['all', 'ready', ...SPIRIT_ORDER.filter((key) => keys.has(key)), ...[...keys].filter((key) => !SPIRIT_ORDER.includes(key))]
      .filter((key, i, list) => list.indexOf(key) === i)
      .map((key) => ({ key, label: key === 'all' ? 'All' : key === 'ready' ? 'Ready now' : tileMeta(key).label }))
  }, [cocktails])
  const list = useMemo(() => {
    let result = scope === 'all' || scope === 'ready' ? cocktails : cocktails.filter((r) => tileKeyForRecipe(r) === scope)
    if (scope === 'ready') result = result.filter((r) => makeableIds([r], byId, have, assumeStaples).has(r.id))
    if (ingredient) result = recipesUsingBottle(ingredient, result, byId, family)
    if (q) result = result.filter((r) => matchesQuery(r, q))
    return result
  }, [cocktails, scope, byId, have, assumeStaples, ingredient, family, q])
  const patch = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    if (key === 'scope') next.delete('makeable')
    setParams(next, { replace: true })
  }
  return <div className={styles.screen}>
    <header className={styles.header}>
      <button className={styles.barSwitch} onClick={() => setManagingBars(true)}><span>{barName}</span><ChevronDownIcon size={13} /></button>
      <h1 className={styles.title}>Recipes</h1>
      <AccentButton label="Recipe" to="/new" />
    </header>
    <div className={styles.searchBar}><SearchIcon size={17} className={styles.searchIcon} /><input className={styles.input} value={q} onChange={(e) => patch('q', e.target.value || null)} placeholder="Search drinks or ingredients" /></div>
    <div className={`${styles.scopeBar} hg-scroll`}><div className={styles.scopeTrack}>{scopes.map((s) => <button key={s.key} className={`${styles.scope} ${scope === s.key ? styles.scopeOn : ''}`} onClick={() => patch('scope', s.key === 'all' ? null : s.key)}>{s.label}</button>)}</div></div>
    {list.length === 0 ? <div className={styles.empty}><h2>{cocktails.length === 0 ? 'No drinks yet' : 'Nothing matches'}</h2><p>{cocktails.length === 0 ? 'Tap Recipe to type your first one in.' : 'Try another spirit, or go back to All.'}</p></div> : <div className={styles.grid}>{list.map((recipe) => <Link key={recipe.id} className={styles.card} to={`/recipe/${recipe.id}`}><div className={styles.photo}><SparkleIcon size={22} /><span>{recipe.name}</span><u>or browse files</u></div><div className={styles.cardFoot}><h2>{recipe.name}</h2><span className={`${styles.status} ${have.size && makeableIds([recipe], byId, have, assumeStaples).has(recipe.id) ? styles.ready : styles.missing}`}><i />{have.size ? (makeableIds([recipe], byId, have, assumeStaples).has(recipe.id) ? 'Ready' : 'Missing') : 'Ready'}</span></div></Link>)}</div>}
    <ManageBarsSheet open={managingBars} onClose={() => setManagingBars(false)} bars={bars} activeId={barId} onSelect={setBarId} counts={counts} />
  </div>
}
