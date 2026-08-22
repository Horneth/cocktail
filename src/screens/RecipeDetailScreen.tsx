import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { IngredientRow, type IngredientLink, type Override } from '../components/IngredientRow'
import { ServingStepper } from '../components/ServingStepper'
import { ChevronLeftIcon, EditIcon, HeartIcon, PlusIcon } from '../components/icons'
import type { Ingredient, Recipe } from '../db/schema'
import { scaleFactor, type ScaleSettings } from '../domain/scaling'
import { bottleFor, missingBottles } from '../domain/availability'
import { convert } from '../domain/units'
import { newId } from '../domain/ids'
import { KIND_LABELS } from '../domain/recipeKind'
import { tileKeyForRecipe } from '../domain/spirits'
import { spiritVisual } from '../domain/spiritVisual'
import { mergeRecipes, saveRecipe, setFavorite } from '../import/importRecipe'
import { useBacklinks, useMixers, useRecipe } from '../hooks/useRecipes'
import { useVolumePreference } from '../hooks/useSettings'
import { useAvailability } from '../hooks/useAvailability'
import { useWakeLock } from '../hooks/useWakeLock'
import styles from './RecipeDetailScreen.module.css'

const PART_PRESETS: { label: string; ml: number | undefined }[] = [
  { label: 'Ratio', ml: undefined },
  { label: '½ oz', ml: 15 },
  { label: '1 oz', ml: 30 },
  { label: '2 oz', ml: 60 },
  { label: '100 ml', ml: 100 },
]

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function RecipeDetailScreen() {
  const { id } = useParams()
  const recipe = useRecipe(id)
  const navigate = useNavigate()
  const [pref, togglePref] = useVolumePreference()
  const { items, have, byId, assumeStaples } = useAvailability()
  const [searchParams, setSearchParams] = useSearchParams()

  // A recipe is the one screen you read with wet hands and no free thumb.
  useWakeLock()

  const missing = useMemo(
    () => (recipe && recipe.kind === 'cocktail' ? missingBottles(recipe, have, byId, assumeStaples) : []),
    [recipe, have, byId, assumeStaples],
  )
  const missingSet = useMemo(() => new Set(missing), [missing])

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
    setOverrides(new Map())
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

  const isMixer = recipe.kind !== 'cocktail'
  const v = spiritVisual(tileKeyForRecipe(recipe))
  const showTicks = !isMixer && have.size > 0
  const canMakeIt = !isMixer && missing.length === 0
  const spiritLabel = recipe.spirit && recipe.spirit !== 'none' ? cap(recipe.spirit) : isMixer ? KIND_LABELS[recipe.kind] : v.label
  const subBits = [spiritLabel, recipe.glassware].filter(Boolean)

  const metaCards = !isMixer
    ? [
        { label: 'Method', value: recipe.method || '—' },
        { label: 'Glass', value: recipe.glassware || '—' },
        {
          label: 'Serves',
          value: recipe.measureBasis === 'parts' ? 'Ratio' : String(recipe.baseServings),
        },
      ]
    : []

  // Every line that names something pourable leads somewhere: to the bottle on
  // your shelf that covers it — the stand-in included, since "any whiskey" is a
  // real answer the availability engine already gives — or to adding the one you
  // don't have. Linked recipes keep their own link (IngredientRow decides).
  const linkFor = (ing: Ingredient): IngredientLink | undefined => {
    const match = bottleFor(ing.name, items)
    if (match) {
      return {
        to: `/bar?bottle=${encodeURIComponent(match.bottle.name)}`,
        ...(match.via === 'category' ? { hint: `your ${match.bottle.label}` } : {}),
      }
    }
    return missingSet.has(ing.name) ? { to: `/bar?add=${encodeURIComponent(ing.name)}` } : undefined
  }

  return (
    <div className={styles.screen}>
      <div className={styles.hero} style={{ background: `linear-gradient(180deg, ${v.tint}, var(--paper))` }}>
        <div className={styles.heroTop}>
          <button className={styles.roundBtn} aria-label="Back" onClick={() => navigate(-1)}>
            <ChevronLeftIcon size={20} />
          </button>
          <div className={styles.heroActions}>
            <button className={styles.prefBtn} onClick={togglePref} aria-label="Toggle units">
              {pref}
            </button>
            {!isMixer && (
              <button
                className={`${styles.roundBtn} ${recipe.favorite ? styles.favOn : ''}`}
                aria-label={recipe.favorite ? 'Unfavorite' : 'Favorite'}
                onClick={() => void setFavorite(recipe.id, !recipe.favorite)}
              >
                <HeartIcon size={20} filled={!!recipe.favorite} />
              </button>
            )}
            <Link className={styles.roundBtn} to={`/recipe/${recipe.id}/edit`} aria-label="Edit">
              <EditIcon size={19} />
            </Link>
          </div>
        </div>
        <div className={styles.heroCenter}>
          <div className={styles.heroEmoji}>{v.emoji}</div>
          <h1 className={styles.title}>{recipe.name}</h1>
          {subBits.length > 0 && <div className={styles.sub}>{subBits.join(' · ')}</div>}
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.tagLine}>{[...recipe.tags, spiritLabel].filter(Boolean).join(' · ')}</div>
        <h1 className={styles.title}>{recipe.name}</h1>
        {/* One line, because the ingredient list below now says which ones —
            each missing line taps straight through to adding that bottle. */}
        {!isMixer && (
          <div className={`${styles.avail} ${canMakeIt ? styles.availReady : styles.availMissing}`}>
            <span className={styles.availEmoji}>{canMakeIt ? '✅' : '🛒'}</span>
            <div className={styles.availTitle}>
              {canMakeIt
                ? 'You can make this'
                : `Missing ${missing.length} ${missing.length === 1 ? 'thing' : 'things'}`}
            </div>
            <button className={styles.availBtn} onClick={() => navigate('/bar')}>
              My Bar
            </button>
          </div>
        )}

        {metaCards.length > 0 && (
          <div className={styles.metaRow}>
            {metaCards.map((m) => (
              <div key={m.label} className={styles.metaCard}>
                <div className={styles.metaLabel}>{m.label}</div>
                <div className={styles.metaValue}>{m.value}</div>
              </div>
            ))}
          </div>
        )}

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

        <h2 className={styles.h2}>Ingredients</h2>
        <div className={styles.ingredients}>
          {recipe.ingredients.map((ing) => (
            <IngredientRow
              key={ing.id}
              ingredient={ing}
              scale={scale}
              pref={pref}
              override={overrides.get(ing.id)}
              editing={editingId === ing.id}
              onStartEdit={() => setEditingId(ing.id)}
              onOverride={(val) => setOverride(ing.id, val)}
              owned={showTicks ? !missingSet.has(ing.name) : undefined}
              link={linkFor(ing)}
            />
          ))}
        </div>

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

        {recipe.tags.length > 0 && (
          <div className={styles.tagChips}>
            {recipe.tags.map((t) => (
              <span key={t} className={styles.tagChip}>
                #{t}
              </span>
            ))}
          </div>
        )}

        {isMixer && <UsedIn recipeId={recipe.id} />}
        {isMixer && <MergeInto recipe={recipe} />}

        <NotesSection notes={recipe.notes} onAdd={addNote} onRemove={removeNote} />

        <div className={styles.bottomSpace} />
      </div>
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
 * Fold this mixer into another one (duplicate cleanup). Every recipe that
 * referenced this one gets repointed to the survivor, then this record is
 * deleted. Shown only for syrups and cordials.
 */
function MergeInto({ recipe }: { recipe: Recipe }) {
  const mixers = useMixers()
  const navigate = useNavigate()
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState(false)

  const others = (mixers ?? []).filter((c) => c.id !== recipe.id && c.kind === recipe.kind)
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
      await mergeRecipes(recipe.id, target.id)
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
        If this is the same as another {KIND_LABELS[recipe.kind].toLowerCase()}, merge it in —
        everything that uses it will point at the one you keep.
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
        <button className={styles.mergeBtn} disabled={!targetId || busy} onClick={() => void merge()}>
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
          <button className={styles.noteDel} aria-label="Delete note" onClick={() => onRemove(n.id)}>
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
