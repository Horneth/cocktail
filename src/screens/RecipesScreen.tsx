import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AccentButton } from '../components/TabBar'
import { ChevronDownIcon, SearchIcon } from '../components/icons'
import { RecipeImage } from '../components/RecipeImage'
import { makeableIds } from '../domain/availability'
import { recipesUsingBottle } from '../domain/barInsights'
import { matchesQuery } from '../domain/search'
import { SPIRIT_ORDER, tileKeyForRecipe, tileMeta } from '../domain/spirits'
import { spiritVisual } from '../domain/spiritVisual'
import { libraryTags, matchesTags, tagEmoji } from '../domain/vocab'
import { displayImage } from '../domain/imagePool'
import { SyrupBottle } from '../components/SyrupBottle'
import { useAllRecipes, useBottleCounts } from '../hooks/useRecipes'
import { useAvailability } from '../hooks/useAvailability'
import { ManageBarsSheet } from './bar/ManageBarsSheet'
import styles from './RecipesScreen.module.css'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function RecipesScreen() {
  const recipes = useAllRecipes() ?? []
  const { byId, have, assumeStaples, barId, bars, setBarId } = useAvailability()
  const counts = useBottleCounts()
  const [params, setParams] = useSearchParams()
  const [managingBars, setManagingBars] = useState(false)
  const q = (params.get('q') ?? '').trim()
  const scope = params.get('scope') || (params.get('makeable') === '1' ? 'ready' : 'all')
  const ingredient = params.get('ingredient') || ''
  const family = params.get('family') || undefined
  const selectedTags = useMemo(
    () => (params.get('tags') ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
    [params],
  )
  const barName = bars.find((b) => b.id === barId)?.name ?? 'Home bar'

  // The whole library — cocktails AND syrups — so a syrup is never a dead end
  // from a tag chip or a link. The Syrups chip joins the spirit row only when
  // mixers exist, and sits after the spirits, before custom spirits.
  const scopes = useMemo(() => {
    const keys = new Set(recipes.map(tileKeyForRecipe))
    return [
      'all',
      'ready',
      ...SPIRIT_ORDER.filter((key) => keys.has(key)),
      ...(['syrup'] as const).filter((key) => keys.has(key)),
      ...[...keys].filter((key) => !SPIRIT_ORDER.includes(key) && key !== 'syrup'),
    ]
      .filter((key, i, list) => list.indexOf(key) === i)
      .map((key) => ({ key, label: key === 'all' ? 'All' : key === 'ready' ? 'Ready now' : tileMeta(key).label }))
  }, [recipes])
  const tags = useMemo(() => libraryTags(recipes), [recipes])
  const list = useMemo(() => {
    let result = scope === 'all' || scope === 'ready' ? recipes : recipes.filter((r) => tileKeyForRecipe(r) === scope)
    if (scope === 'ready') result = result.filter((r) => makeableIds([r], byId, have, assumeStaples).has(r.id))
    if (ingredient) result = recipesUsingBottle(ingredient, result, byId, family)
    if (selectedTags.length) result = result.filter((r) => matchesTags(r, selectedTags))
    if (q) result = result.filter((r) => matchesQuery(r, q))
    return result
  }, [recipes, scope, byId, have, assumeStaples, ingredient, family, selectedTags, q])
  const patch = (key: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    if (key === 'scope') next.delete('makeable')
    setParams(next, { replace: true })
  }
  const toggleTag = (tag: string) => {
    const next = selectedTags.includes(tag) ? selectedTags.filter((t) => t !== tag) : [...selectedTags, tag]
    patch('tags', next.length ? next.join(',') : null)
  }
  const showCardArt = (recipe: (typeof recipes)[number]) => {
    if (recipe.kind === 'syrup') {
      return (
        <span className={styles.photoArt} style={{ background: spiritVisual('syrup').tint }}>
          <SyrupBottle name={recipe.name} size={64} />
        </span>
      )
    }
    const v = spiritVisual(tileKeyForRecipe(recipe))
    return (
      <span className={styles.photoArt} style={{ background: v.tint }}>
        {v.emoji}
      </span>
    )
  }
  return <div className={styles.screen}>
    <header className={styles.header}>
      <button className={styles.barSwitch} onClick={() => setManagingBars(true)}><span>{barName}</span><ChevronDownIcon size={13} /></button>
      <h1 className={styles.title}>Recipes</h1>
      <AccentButton label="Recipe" to="/new" />
    </header>
    <div className={styles.searchBar}><SearchIcon size={17} className={styles.searchIcon} /><input className={styles.input} value={q} onChange={(e) => patch('q', e.target.value || null)} placeholder="Search drinks or ingredients" /></div>
    <div className={`${styles.scopeBar} hg-scroll`}><div className={styles.scopeTrack}>{scopes.map((s) => <button key={s.key} className={`${styles.scope} ${scope === s.key ? styles.scopeOn : ''}`} onClick={() => patch('scope', s.key === 'all' ? null : s.key)}>{s.label}</button>)}</div></div>
    {tags.length > 0 && (
      <div className={`${styles.scopeBar} ${styles.tagBar} hg-scroll`}>
        <div className={styles.scopeTrack}>
          {tags.map((t) => (
            <button key={t} className={`${styles.scope} ${styles.scopeTag} ${selectedTags.includes(t) ? styles.scopeOn : ''}`} onClick={() => toggleTag(t)}>
              <span className={styles.tagGlyph} aria-hidden>{tagEmoji(t)}</span>{cap(t)}
            </button>
          ))}
        </div>
      </div>
    )}
    {list.length === 0 ? <div className={styles.empty}><h2>{recipes.length === 0 ? 'No drinks yet' : 'Nothing matches'}</h2><p>{recipes.length === 0 ? 'Tap Recipe to type your first one in.' : 'Try another spirit, or go back to All.'}</p></div> : <div className={styles.grid}>{list.map((recipe) => <Link key={recipe.id} className={styles.card} to={`/recipe/${recipe.id}`}><div className={styles.photo}><RecipeImage image={displayImage(recipe)} size="card" sizes="(max-width: 480px) 45vw, 200px" className={styles.photoImg} generating={recipe.imageStatus === 'pending'} fallback={showCardArt(recipe)} /></div><div className={styles.cardFoot}><h2>{recipe.name}</h2><span className={`${styles.status} ${have.size && makeableIds([recipe], byId, have, assumeStaples).has(recipe.id) ? styles.ready : styles.missing}`}><i />{have.size ? (makeableIds([recipe], byId, have, assumeStaples).has(recipe.id) ? 'Ready' : 'Missing') : 'Ready'}</span></div></Link>)}</div>}
    <ManageBarsSheet open={managingBars} onClose={() => setManagingBars(false)} bars={bars} activeId={barId} onSelect={setBarId} counts={counts} />
  </div>
}
