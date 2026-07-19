import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { IngredientRow, type Override } from '../components/IngredientRow'
import { ServingStepper } from '../components/ServingStepper'
import { ChevronLeftIcon, EditIcon, FlaskIcon, HeartIcon, PlusIcon } from '../components/icons'
import type { Ingredient, Recipe } from '../db/schema'
import { scaleFactor, type ScaleSettings } from '../domain/scaling'
import { convert } from '../domain/units'
import { newId } from '../domain/ids'
import { mergeComponents, saveRecipe, setFavorite } from '../import/importRecipe'
import { useBacklinks, useComponents, useRecipe } from '../hooks/useRecipes'
import { useVolumePreference } from '../hooks/useSettings'
import styles from './RecipeDetailScreen.module.css'

const PART_PRESETS: { label: string; ml: number | undefined }[] = [
  { label: 'Ratio', ml: undefined },
  { label: '½ oz', ml: 15 },
  { label: '1 oz', ml: 30 },
  { label: '2 oz', ml: 60 },
  { label: '100 ml', ml: 100 },
]

export function RecipeDetailScreen() {
  const { id } = useParams()
  const recipe = useRecipe(id)
  const navigate = useNavigate()
  const [pref, togglePref] = useVolumePreference()
  const [searchParams, setSearchParams] = useSearchParams()

  const [overrides, setOverrides] = useState<Map<string, Override>>(new Map())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [mlPerPart, setMlPerPart] = useState<number | undefined>(undefined)

  const multiplier = Number(searchParams.get('x')) || 1

  const scale: ScaleSettings | null = useMemo(() => {
    if (!recipe) return null
    if (recipe.measureBasis === 'parts') {
      return {
        measureBasis: 'parts',
        baseServings: recipe.baseServings,
        targetServings: recipe.baseServings,
        mlPerPart,
      }
    }
    return {
      measureBasis: 'absolute',
      baseServings: recipe.baseServings,
      targetServings: recipe.baseServings * multiplier,
    }
  }, [recipe, multiplier, mlPerPart])

  if (recipe === undefined || scale === null) {
    return <div className={styles.loading}>…</div>
  }
  if (recipe === null) {
    return (
      <div className={styles.notFound}>
        <p>Recipe not found.</p>
        <Link to="/">Back to list</Link>
      </div>
    )
  }

  const setMultiplier = (m: number) => {
    setOverrides(new Map()) // scaling changed → drop transient tweaks
    setEditingId(null)
    setSearchParams(m === 1 ? {} : { x: String(m) }, { replace: true })
  }

  const setOverride = (ingId: string, value: Override | undefined) => {
    setOverrides((prev) => {
      const next = new Map(prev)
      if (value === undefined) next.delete(ingId)
      else next.set(ingId, value)
      return next
    })
  }

  const hasOverrides = overrides.size > 0

  const saveTweaks = async () => {
    const updated: Recipe = {
      ...recipe,
      ingredients: recipe.ingredients.map((ing) => {
        const ov = overrides.get(ing.id)
        if (!ov) return ing
        return { ...ing, amount: overrideToBase(ing, ov, scale) }
      }),
    }
    await saveRecipe(updated)
    setOverrides(new Map())
    setEditingId(null)
  }

  const addNote = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const updated: Recipe = {
      ...recipe,
      notes: [...(recipe.notes ?? []), { id: newId(), text: trimmed, createdAt: Date.now() }],
    }
    await saveRecipe(updated)
  }

  const removeNote = async (noteId: string) => {
    const updated: Recipe = {
      ...recipe,
      notes: (recipe.notes ?? []).filter((n) => n.id !== noteId),
    }
    await saveRecipe(updated)
  }

  const isComponent = recipe.kind === 'component'
  const metaBits = [recipe.method, recipe.glassware].filter(Boolean)

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button className={styles.iconBtn} aria-label="Back" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={26} />
        </button>
        <div className={styles.headerRight}>
          <button className={styles.prefBtn} onClick={togglePref} aria-label="Toggle units">
            {pref}
          </button>
          {recipe.kind === 'cocktail' && (
            <button
              className={`${styles.iconBtn} ${recipe.favorite ? styles.favActive : ''}`}
              aria-label={recipe.favorite ? 'Unfavorite' : 'Favorite'}
              onClick={() => void setFavorite(recipe.id, !recipe.favorite)}
            >
              <HeartIcon size={23} filled={!!recipe.favorite} />
            </button>
          )}
          <Link className={styles.iconBtn} to={`/recipe/${recipe.id}/edit`} aria-label="Edit">
            <EditIcon size={22} />
          </Link>
        </div>
      </header>

      <div className={styles.titleBlock}>
        {isComponent && (
          <span className={styles.kindTag}>
            <FlaskIcon size={13} /> Sub-recipe
          </span>
        )}
        <h1 className={styles.title}>{recipe.name}</h1>
        {metaBits.length > 0 && <p className={styles.meta}>{metaBits.join(' · ')}</p>}
      </div>

      {recipe.measureBasis === 'parts' ? (
        <div className={styles.partsControl}>
          <span className={styles.partsLabel}>1 part =</span>
          <div className={styles.presets}>
            {PART_PRESETS.map((p) => (
              <button
                key={p.label}
                className={`${styles.preset} ${mlPerPart === p.ml ? styles.presetActive : ''}`}
                onClick={() => setMlPerPart(p.ml)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className={styles.stepperWrap}>
          <ServingStepper
            multiplier={multiplier}
            baseServings={recipe.baseServings}
            onChange={setMultiplier}
          />
        </div>
      )}

      <section className={styles.ingredients}>
        {recipe.ingredients.map((ing) => (
          <IngredientRow
            key={ing.id}
            ingredient={ing}
            scale={scale}
            pref={pref}
            override={overrides.get(ing.id)}
            editing={editingId === ing.id}
            onStartEdit={() => setEditingId(ing.id)}
            onOverride={(v) => setOverride(ing.id, v)}
          />
        ))}
      </section>

      {hasOverrides && (
        <div className={styles.tweakBar}>
          <span>Adjusted for this build</span>
          <div className={styles.tweakActions}>
            <button className={styles.ghostBtn} onClick={() => setOverrides(new Map())}>
              Reset
            </button>
            <button className={styles.solidBtn} onClick={saveTweaks}>
              Save to recipe
            </button>
          </div>
        </div>
      )}

      {recipe.garnish && (
        <p className={styles.garnish}>
          <span className={styles.garnishLabel}>Garnish</span> {recipe.garnish}
        </p>
      )}

      {recipe.instructions && (
        <section className={styles.section}>
          <h2 className={styles.h2}>Method</h2>
          <p className={styles.instructions}>{recipe.instructions}</p>
        </section>
      )}

      {isComponent && <UsedIn recipeId={recipe.id} />}

      {isComponent && <MergeInto recipe={recipe} />}

      <NotesSection notes={recipe.notes} onAdd={addNote} onRemove={removeNote} />

      <div className={styles.bottomSpace} />
    </div>
  )
}

function UsedIn({ recipeId }: { recipeId: string }) {
  const parents = useBacklinks(recipeId)
  if (!parents || parents.length === 0) return null
  return (
    <section className={styles.section}>
      <h2 className={styles.h2}>Used in</h2>
      <div className={styles.usedInList}>
        {parents.map((p) => (
          <Link key={p.id} className={styles.usedInChip} to={`/recipe/${p.id}`}>
            {p.name}
          </Link>
        ))}
      </div>
    </section>
  )
}

/**
 * Fold this component into another one (duplicate cleanup). Every cocktail that
 * referenced this syrup gets repointed to the survivor, then this record is
 * deleted. Shown only for components.
 */
function MergeInto({ recipe }: { recipe: Recipe }) {
  const components = useComponents()
  const navigate = useNavigate()
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)

  const others = (components ?? []).filter((c) => c.id !== recipe.id)
  if (others.length === 0) return null

  const merge = async () => {
    const target = others.find((c) => c.id === targetId)
    if (!target || busy) return
    if (
      !confirm(
        `Merge “${recipe.name}” into “${target.name}”? Recipes using “${recipe.name}” will point at “${target.name}”, and “${recipe.name}” will be deleted.`,
      )
    ) {
      return
    }
    setBusy(true)
    try {
      await mergeComponents(recipe.id, target.id)
      navigate(`/recipe/${target.id}`, { replace: true })
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not merge.')
      setBusy(false)
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.h2}>Duplicate?</h2>
      <p className={styles.mergeHint}>
        If this is the same as another sub-recipe, merge it in — everything that
        uses it will point at the one you keep.
      </p>
      <div className={styles.mergeRow}>
        <select
          className={styles.mergeSelect}
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
        >
          <option value="">Merge into…</option>
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          className={styles.mergeBtn}
          disabled={!targetId || busy}
          onClick={() => void merge()}
        >
          {busy ? 'Merging…' : 'Merge'}
        </button>
      </div>
    </section>
  )
}

function NotesSection({
  notes,
  onAdd,
  onRemove,
}: {
  notes: Recipe['notes']
  onAdd: (t: string) => void
  onRemove: (id: string) => void
}) {
  const [draft, setDraft] = useState('')
  const list = Array.isArray(notes) ? notes : []
  return (
    <section className={styles.section}>
      <h2 className={styles.h2}>Notes</h2>
      {list.map((n) => (
        <div key={n.id} className={styles.note}>
          <p>{n.text}</p>
          <button
            className={styles.noteDel}
            aria-label="Delete note"
            onClick={() => onRemove(n.id)}
          >
            ×
          </button>
        </div>
      ))}
      <div className={styles.noteAdd}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note (e.g. use less syrup)…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onAdd(draft)
              setDraft('')
            }
          }}
        />
        <button
          className={styles.noteAddBtn}
          aria-label="Add note"
          onClick={() => {
            onAdd(draft)
            setDraft('')
          }}
        >
          <PlusIcon size={20} />
        </button>
      </div>
    </section>
  )
}

/** Convert a per-build override back to the stored base amount in the ingredient's own unit. */
function overrideToBase(ing: Ingredient, ov: Override, scale: ScaleSettings): number {
  if (scale.measureBasis === 'parts' && ing.unit === 'part') {
    if (scale.mlPerPart && scale.mlPerPart > 0) {
      const ml = convert(ov.amount, ov.unit, 'ml')
      return Math.round((ml / scale.mlPerPart) * 1000) / 1000
    }
    return ov.amount
  }
  const native = convert(ov.amount, ov.unit, ing.unit)
  const factor = scaleFactor(scale)
  return Math.round((factor ? native / factor : native) * 1000) / 1000
}
