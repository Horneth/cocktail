import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeftIcon, FlaskIcon, PlusIcon, TrashIcon } from '../components/icons'
import { db } from '../db/db'
import type {
  Ingredient,
  MeasureBasis,
  Recipe,
  RecipeKind,
  SpiritCategory,
  Unit,
} from '../db/schema'
import { newId } from '../domain/ids'
import { UNIT_ORDER, UNITS } from '../domain/units'
import { deleteRecipe, saveRecipe } from '../import/importRecipe'
import { useComponents, useRecipe } from '../hooks/useRecipes'
import styles from './EditRecipeScreen.module.css'

const SPIRITS: SpiritCategory[] = [
  'gin', 'vodka', 'rum', 'whiskey', 'tequila', 'agave',
  'brandy', 'liqueur', 'wine', 'other', 'none',
]

const METHODS = ['Shake', 'Stir', 'Build', 'Blend', 'Throw', 'Swizzle']

function blankIngredient(): Ingredient {
  return { id: newId(), name: '', amount: null, unit: 'oz' }
}

function emptyRecipe(kind: RecipeKind): Recipe {
  const now = Date.now()
  return {
    id: newId(),
    kind,
    name: '',
    ingredients: [blankIngredient()],
    measureBasis: kind === 'component' ? 'parts' : 'absolute',
    baseServings: 1,
    tags: [],
    notes: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function EditRecipeScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = !id
  const existing = useRecipe(id)
  const components = useComponents()

  const [form, setForm] = useState<Recipe | null>(isNew ? emptyRecipe('cocktail') : null)
  const [tagInput, setTagInput] = useState('')

  useEffect(() => {
    if (!isNew && existing && !form) {
      setForm(structuredClone(existing))
      setTagInput(existing.tags.join(', '))
    }
  }, [existing, isNew, form])

  if (!form) {
    return <div className={styles.loading}>…</div>
  }

  const update = (patch: Partial<Recipe>) => setForm((f) => (f ? { ...f, ...patch } : f))

  const updateIngredient = (ingId: string, patch: Partial<Ingredient>) =>
    setForm((f) =>
      f
        ? { ...f, ingredients: f.ingredients.map((i) => (i.id === ingId ? { ...i, ...patch } : i)) }
        : f,
    )

  const addRow = () =>
    setForm((f) => (f ? { ...f, ingredients: [...f.ingredients, blankIngredient()] } : f))

  const removeRow = (ingId: string) =>
    setForm((f) => (f ? { ...f, ingredients: f.ingredients.filter((i) => i.id !== ingId) } : f))

  const canSave = form.name.trim() !== '' && form.ingredients.some((i) => i.name.trim() !== '')

  const onSave = async () => {
    const cleaned: Recipe = {
      ...form,
      name: form.name.trim(),
      tags: tagInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      ingredients: form.ingredients
        .filter((i) => i.name.trim() !== '')
        .map((i) => ({ ...i, name: i.name.trim() })),
    }
    await saveRecipe(cleaned)
    navigate(`/recipe/${cleaned.id}`, { replace: true })
  }

  const onDelete = async () => {
    if (!confirm(`Delete “${form.name}”? This can't be undone.`)) return
    await deleteRecipe(form.id)
    navigate('/', { replace: true })
  }

  const isComponent = form.kind === 'component'

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button className={styles.iconBtn} aria-label="Cancel" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={26} />
        </button>
        <span className={styles.headTitle}>{isNew ? 'New recipe' : 'Edit'}</span>
        <button className={styles.saveBtn} disabled={!canSave} onClick={onSave}>
          Save
        </button>
      </header>

      <div className={styles.body}>
        <input
          className={styles.nameInput}
          value={form.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder={isComponent ? 'Syrup name…' : 'Cocktail name…'}
          autoFocus={isNew}
        />

        <div className={styles.segment}>
          {(['cocktail', 'component'] as RecipeKind[]).map((k) => (
            <button
              key={k}
              className={`${styles.segBtn} ${form.kind === k ? styles.segActive : ''}`}
              onClick={() =>
                update({ kind: k, measureBasis: k === 'component' ? 'parts' : form.measureBasis })
              }
            >
              {k === 'cocktail' ? 'Cocktail' : 'Sub-recipe'}
            </button>
          ))}
        </div>

        {/* measure basis */}
        <div className={styles.fieldRow}>
          <label className={styles.label}>Measured in</label>
          <div className={styles.segment}>
            {(['absolute', 'parts'] as MeasureBasis[]).map((b) => (
              <button
                key={b}
                className={`${styles.segBtn} ${form.measureBasis === b ? styles.segActive : ''}`}
                onClick={() => update({ measureBasis: b })}
              >
                {b === 'absolute' ? 'Volumes' : 'Parts / ratio'}
              </button>
            ))}
          </div>
        </div>

        {/* ingredients */}
        <h2 className={styles.h2}>Ingredients</h2>
        <div className={styles.ingredients}>
          {form.ingredients.map((ing) => (
            <IngredientEditor
              key={ing.id}
              ingredient={ing}
              partsMode={form.measureBasis === 'parts'}
              components={components ?? []}
              currentRecipeId={form.id}
              onChange={(patch) => updateIngredient(ing.id, patch)}
              onRemove={() => removeRow(ing.id)}
            />
          ))}
        </div>
        <button className={styles.addRow} onClick={addRow}>
          <PlusIcon size={18} /> Add ingredient
        </button>

        {/* cocktail-only build fields */}
        {!isComponent && (
          <>
            <h2 className={styles.h2}>Build</h2>
            <div className={styles.grid2}>
              <Field label="Spirit">
                <select
                  value={form.spirit ?? ''}
                  onChange={(e) => update({ spirit: (e.target.value || undefined) as SpiritCategory })}
                >
                  <option value="">—</option>
                  {SPIRITS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Method">
                <select
                  value={form.method ?? ''}
                  onChange={(e) => update({ method: e.target.value || undefined })}
                >
                  <option value="">—</option>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Glass">
                <input
                  value={form.glassware ?? ''}
                  onChange={(e) => update({ glassware: e.target.value || undefined })}
                  placeholder="Coupe, Rocks…"
                />
              </Field>
              <Field label="Garnish">
                <input
                  value={form.garnish ?? ''}
                  onChange={(e) => update({ garnish: e.target.value || undefined })}
                  placeholder="Lime wheel…"
                />
              </Field>
            </div>
          </>
        )}

        <h2 className={styles.h2}>Method steps</h2>
        <textarea
          className={styles.textarea}
          rows={4}
          value={form.instructions ?? ''}
          onChange={(e) => update({ instructions: e.target.value || undefined })}
          placeholder="How to build it…"
        />

        <h2 className={styles.h2}>Tags</h2>
        <input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          placeholder="sour, tiki, citrusy (comma-separated)"
        />

        {!isNew && (
          <button className={styles.deleteBtn} onClick={onDelete}>
            <TrashIcon size={18} /> Delete recipe
          </button>
        )}
        <div className={styles.bottomSpace} />
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.label}>{label}</span>
      {children}
    </label>
  )
}

interface IngEditorProps {
  ingredient: Ingredient
  partsMode: boolean
  components: Recipe[]
  currentRecipeId: string
  onChange: (patch: Partial<Ingredient>) => void
  onRemove: () => void
}

function IngredientEditor({
  ingredient,
  partsMode,
  components,
  currentRecipeId,
  onChange,
  onRemove,
}: IngEditorProps) {
  const [focused, setFocused] = useState(false)

  const suggestions = useMemo(() => {
    const q = ingredient.name.trim().toLowerCase()
    if (!q) return []
    return components
      .filter((c) => c.id !== currentRecipeId && c.name.toLowerCase().includes(q))
      .slice(0, 4)
  }, [components, ingredient.name, currentRecipeId])

  const exactMatch = components.some(
    (c) => c.name.toLowerCase() === ingredient.name.trim().toLowerCase(),
  )

  const linkTo = (comp: Recipe) => {
    onChange({ name: comp.name, subRecipeId: comp.id })
    setFocused(false)
  }

  const makeSubRecipe = async () => {
    const name = ingredient.name.trim()
    if (!name) return
    const now = Date.now()
    const stub: Recipe = {
      id: newId(),
      kind: 'component',
      name,
      ingredients: [],
      measureBasis: 'parts',
      baseServings: 1,
      tags: [],
      notes: [],
      createdAt: now,
      updatedAt: now,
    }
    await db.recipes.put(stub)
    onChange({ name, subRecipeId: stub.id })
    setFocused(false)
  }

  const showDropdown =
    focused && ingredient.name.trim() !== '' && !ingredient.subRecipeId && !partsMode

  return (
    <div className={styles.ingEditor}>
      <div className={styles.ingTop}>
        <input
          className={styles.amountInput}
          type="number"
          inputMode="decimal"
          step="any"
          value={ingredient.amount ?? ''}
          onChange={(e) =>
            onChange({ amount: e.target.value === '' ? null : Number(e.target.value) })
          }
          placeholder="—"
        />
        <select
          className={styles.unitSelect}
          value={ingredient.unit}
          onChange={(e) => onChange({ unit: e.target.value as Unit })}
        >
          {UNIT_ORDER.map((u) => (
            <option key={u} value={u}>
              {UNITS[u].label || u}
            </option>
          ))}
        </select>
        <button className={styles.rowDel} aria-label="Remove" onClick={onRemove}>
          <TrashIcon size={18} />
        </button>
      </div>

      <div className={styles.nameWrap}>
        <input
          className={ingredient.subRecipeId ? styles.nameLinked : ''}
          value={ingredient.name}
          onChange={(e) => onChange({ name: e.target.value, subRecipeId: undefined })}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Ingredient name"
        />
        {ingredient.subRecipeId && (
          <span className={styles.linkBadge}>
            <FlaskIcon size={13} /> linked
          </span>
        )}

        {showDropdown && (suggestions.length > 0 || !exactMatch) && (
          <div className={styles.dropdown}>
            {suggestions.map((c) => (
              <button key={c.id} className={styles.suggestion} onMouseDown={() => linkTo(c)}>
                <FlaskIcon size={14} /> {c.name}
              </button>
            ))}
            {!exactMatch && (
              <button className={styles.suggestionNew} onMouseDown={makeSubRecipe}>
                <PlusIcon size={14} /> Make “{ingredient.name.trim()}” a sub-recipe
              </button>
            )}
          </div>
        )}
      </div>

      <div className={styles.ingBottom}>
        <label className={styles.optToggle}>
          <input
            type="checkbox"
            checked={ingredient.optional ?? false}
            onChange={(e) => onChange({ optional: e.target.checked || undefined })}
          />
          optional
        </label>
        <input
          className={styles.noteInput}
          value={ingredient.note ?? ''}
          onChange={(e) => onChange({ note: e.target.value || undefined })}
          placeholder="note (e.g. fresh)"
        />
      </div>
    </div>
  )
}
