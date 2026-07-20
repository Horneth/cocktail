import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeftIcon, FlaskIcon, PlusIcon, TrashIcon } from '../components/icons'
import { db } from '../db/db'
import type { Ingredient, MeasureBasis, Recipe, RecipeKind, Unit } from '../db/schema'
import { newId } from '../domain/ids'
import { KNOWN_SPIRITS } from '../domain/spirits'
import { spiritVisual } from '../domain/spiritVisual'
import { UNIT_ORDER, UNITS } from '../domain/units'
import { deleteRecipe, saveRecipe } from '../import/importRecipe'
import {
  useComponents,
  useKnownIngredients,
  useRecipe,
  useSpiritSuggestions,
} from '../hooks/useRecipes'
import styles from './EditRecipeScreen.module.css'

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
  const knownIngredients = useKnownIngredients()
  const spiritSuggestions = useSpiritSuggestions()

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
      spirit: form.spirit?.trim().toLowerCase() || undefined,
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
  const currentSpirit = form.spirit?.trim().toLowerCase()

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button className={styles.back} aria-label="Cancel" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={20} />
        </button>
        <h1 className={styles.title}>{isNew ? 'New recipe' : 'Edit recipe'}</h1>
      </header>

      <div className={styles.body}>
        <label className={styles.label}>Name</label>
        <div className={styles.inputCard}>
          <input
            className={styles.nameInput}
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={isComponent ? 'e.g. Rich Simple Syrup' : 'e.g. Midnight Sour'}
            autoFocus={isNew}
          />
        </div>

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

        {!isComponent && (
          <>
            <label className={styles.label}>Base spirit</label>
            <div className={`${styles.chipRow} hg-scroll`}>
              {KNOWN_SPIRITS.map((k) => {
                const v = spiritVisual(k)
                return (
                  <button
                    key={k}
                    className={`${styles.spiritChip} ${currentSpirit === k ? styles.spiritChipOn : ''}`}
                    onClick={() => update({ spirit: currentSpirit === k ? undefined : k })}
                  >
                    <span className={styles.spiritEmoji}>{v.emoji}</span>
                    {v.label}
                  </button>
                )
              })}
            </div>
          </>
        )}

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

        <label className={styles.label}>Ingredients</label>
        <div className={styles.ingredients}>
          {form.ingredients.map((ing) => (
            <IngredientEditor
              key={ing.id}
              ingredient={ing}
              partsMode={form.measureBasis === 'parts'}
              components={components ?? []}
              knownNames={knownIngredients}
              currentRecipeId={form.id}
              onChange={(patch) => updateIngredient(ing.id, patch)}
              onRemove={() => removeRow(ing.id)}
            />
          ))}
        </div>
        <button className={styles.addRow} onClick={addRow}>
          <PlusIcon size={17} /> Add ingredient
        </button>

        {!isComponent && (
          <>
            <label className={styles.label}>Build</label>
            <div className={styles.grid2}>
              <Field label="Spirit (custom)">
                <input
                  list="spirit-suggestions"
                  value={form.spirit ?? ''}
                  onChange={(e) => update({ spirit: e.target.value || undefined })}
                  placeholder="gin, cachaça…"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                <datalist id="spirit-suggestions">
                  {spiritSuggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
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

        <label className={styles.label}>Method steps</label>
        <div className={styles.inputCard}>
          <textarea
            className={styles.textarea}
            rows={4}
            value={form.instructions ?? ''}
            onChange={(e) => update({ instructions: e.target.value || undefined })}
            placeholder="One step per line…"
          />
        </div>

        <label className={styles.label}>Tags</label>
        <div className={styles.inputCard}>
          <input
            className={styles.nameInput}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            placeholder="sour, tiki, citrusy (comma-separated)"
          />
        </div>

        {!isNew && (
          <button className={styles.deleteBtn} onClick={onDelete}>
            <TrashIcon size={18} /> Delete recipe
          </button>
        )}
        <div className={styles.bottomSpace} />
      </div>

      <div className={styles.ctaWrap}>
        <button className={`${styles.cta} ${canSave ? '' : styles.ctaOff}`} disabled={!canSave} onClick={onSave}>
          Save recipe
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  )
}

interface IngEditorProps {
  ingredient: Ingredient
  partsMode: boolean
  components: Recipe[]
  knownNames: string[]
  currentRecipeId: string
  onChange: (patch: Partial<Ingredient>) => void
  onRemove: () => void
}

function IngredientEditor({
  ingredient,
  partsMode,
  components,
  knownNames,
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

  const nameMatches = useMemo(() => {
    const q = ingredient.name.trim().toLowerCase()
    if (!q) return []
    const compNames = new Set(components.map((c) => c.name.toLowerCase()))
    return knownNames
      .filter((n) => {
        const l = n.toLowerCase()
        return l.includes(q) && l !== q && !compNames.has(l)
      })
      .slice(0, 5)
  }, [knownNames, ingredient.name, components])

  const exactMatch = components.some(
    (c) => c.name.toLowerCase() === ingredient.name.trim().toLowerCase(),
  )
  const showLinkOptions = !partsMode && !ingredient.subRecipeId

  const pickName = (name: string) => {
    onChange({ name, subRecipeId: undefined })
    setFocused(false)
  }
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
    focused &&
    ingredient.name.trim() !== '' &&
    (nameMatches.length > 0 || (showLinkOptions && (suggestions.length > 0 || !exactMatch)))

  return (
    <div className={styles.ingEditor}>
      <div className={styles.ingTop}>
        <input
          className={styles.amountInput}
          type="number"
          inputMode="decimal"
          step="any"
          value={ingredient.amount ?? ''}
          onChange={(e) => onChange({ amount: e.target.value === '' ? null : Number(e.target.value) })}
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

        {showDropdown && (
          <div className={styles.dropdown}>
            {nameMatches.map((n) => (
              <button key={n} className={styles.suggestion} onMouseDown={() => pickName(n)}>
                {n}
              </button>
            ))}
            {showLinkOptions &&
              suggestions.map((c) => (
                <button key={c.id} className={styles.suggestion} onMouseDown={() => linkTo(c)}>
                  <FlaskIcon size={14} /> {c.name}
                </button>
              ))}
            {showLinkOptions && !exactMatch && (
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
