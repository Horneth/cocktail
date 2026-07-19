import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ChevronLeftIcon,
  FlaskIcon,
  PlayIcon,
  PlusIcon,
  SparkleIcon,
  TrashIcon,
} from '../components/icons'
import { FEATURES } from '../config'
import type { Unit } from '../db/schema'
import { UNIT_ORDER, UNITS } from '../domain/units'
import { GeminiError, geminiParse } from '../import/gemini'
import { importRecipe } from '../import/importRecipe'
import { parseRecipeText } from '../import/parseRecipeText'
import type { IngredientDraft, RecipeDraft, StructuredImport } from '../import/types'
import { consumeSharedImport } from '../import/shared'
import { useKnownIngredients, useSpiritSuggestions } from '../hooks/useRecipes'
import { useGeminiSettings } from '../hooks/useSettings'
import styles from './ImportScreen.module.css'

const INGREDIENT_LIST_ID = 'known-ingredients'

interface Draft {
  recipes: StructuredImport[]
  ok: boolean
}

export function ImportScreen() {
  const navigate = useNavigate()
  const knownIngredients = useKnownIngredients()
  const spiritSuggestions = useSpiritSuggestions()
  const gemini = useGeminiSettings()
  const aiEnabled = FEATURES.cloudAI && gemini.hasKey
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const parse = () => {
    setAiError(null)
    const result = parseRecipeText(text)
    setExcluded(new Set())
    setSelected(new Set([0]))
    setDraft({ recipes: [{ main: result.main, components: result.components }], ok: result.ok })
  }

  const smartParse = async () => {
    if (aiBusy) return
    setAiError(null)
    setAiBusy(true)
    try {
      const recipes = await geminiParse(text, gemini.apiKey, gemini.model)
      setExcluded(new Set())
      setSelected(new Set(recipes.map((_, i) => i)))
      setDraft({ recipes, ok: true })
    } catch (err) {
      // Fall back gracefully to the offline parser; keep the user on this screen.
      setAiError(err instanceof GeminiError ? err.message : 'AI parse failed. Try Basic parse.')
    } finally {
      setAiBusy(false)
    }
  }

  // Parse an explicit string (the share auto-parse can't wait for `text` state).
  const runParse = (t: string, ai: boolean) => {
    if (ai) {
      setAiBusy(true)
      geminiParse(t, gemini.apiKey, gemini.model)
        .then((recipes) => {
          setSelected(new Set(recipes.map((_, i) => i)))
          setDraft({ recipes, ok: true })
        })
        .catch((err) =>
          setAiError(err instanceof GeminiError ? err.message : 'AI parse failed. Try Basic parse.'),
        )
        .finally(() => setAiBusy(false))
    } else {
      const result = parseRecipeText(t)
      setSelected(new Set([0]))
      setDraft({ recipes: [{ main: result.main, components: result.components }], ok: result.ok })
    }
  }

  // If the user shared a video/description into the app (Android share target),
  // prefill the box and parse it automatically with whatever engine is on.
  const sharedApplied = useRef(false)
  useEffect(() => {
    if (sharedApplied.current || draft) return
    const shared = consumeSharedImport()
    if (!shared) return
    sharedApplied.current = true
    setText(shared)
    runParse(shared, aiEnabled)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Back to the previous screen, or home if Import is the first history entry
  // (e.g. opened cold from an Android share) so Back is never a dead end.
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/')
  }

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (t) setText(t)
    } catch {
      /* clipboard blocked — user can paste manually */
    }
  }

  const recipes = draft?.recipes ?? []
  const single = draft && recipes.length === 1 ? recipes[0] : null

  // ---- single-draft mutation helpers (immutable, operate on recipes[0]) ----
  const patchRecipe0 = (fn: (imp: StructuredImport) => StructuredImport) =>
    setDraft((d) => (d ? { ...d, recipes: [fn(d.recipes[0]), ...d.recipes.slice(1)] } : d))

  const patchMain = (patch: Partial<RecipeDraft>) =>
    patchRecipe0((imp) => ({ ...imp, main: { ...imp.main, ...patch } }))

  const patchRecipeIngredients = (tempId: string, ings: IngredientDraft[]) =>
    patchRecipe0((imp) => {
      if (imp.main.tempId === tempId) return { ...imp, main: { ...imp.main, ingredients: ings } }
      return {
        ...imp,
        components: imp.components.map((c) => (c.tempId === tempId ? { ...c, ingredients: ings } : c)),
      }
    })

  const patchComponent = (tempId: string, patch: Partial<RecipeDraft>) =>
    patchRecipe0((imp) => ({
      ...imp,
      components: imp.components.map((c) => (c.tempId === tempId ? { ...c, ...patch } : c)),
    }))

  const toggleComponent = (tempId: string) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      next.has(tempId) ? next.delete(tempId) : next.add(tempId)
      return next
    })

  const toggleSelected = (idx: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })

  const canImportSingle = useMemo(
    () => !!single && single.main.name.trim() !== '' && single.main.ingredients.some((i) => i.name.trim()),
    [single],
  )

  // Trim empties and stamp provenance just before writing.
  const cleanImport = (imp: StructuredImport, drop: Set<string>): StructuredImport => ({
    main: {
      ...imp.main,
      name: imp.main.name.trim(),
      ingredients: imp.main.ingredients.filter((i) => i.name.trim()),
      source: { ...imp.main.source, type: imp.main.source?.type ?? 'web', importedAt: Date.now() },
    },
    components: imp.components
      .filter((c) => !drop.has(c.tempId) && c.name.trim() && c.ingredients.length)
      .map((c) => ({ ...c, ingredients: c.ingredients.filter((i) => i.name.trim()) })),
  })

  const doImportSingle = async () => {
    if (!single || saving) return
    setSaving(true)
    try {
      const { mainId } = await importRecipe(cleanImport(single, excluded))
      navigate(`/recipe/${mainId}`, { replace: true })
    } finally {
      setSaving(false)
    }
  }

  const doImportSelected = async () => {
    if (saving || selected.size === 0) return
    setSaving(true)
    try {
      const chosen = recipes.filter((_, i) => selected.has(i))
      let lastMainId = ''
      // sequential so importRecipe dedupes a shared syrup across drinks
      for (const imp of chosen) {
        const { mainId } = await importRecipe(cleanImport(imp, new Set()))
        lastMainId = mainId
      }
      if (chosen.length === 1) navigate(`/recipe/${lastMainId}`, { replace: true })
      else navigate('/', { replace: true })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.screen}>
      <datalist id={INGREDIENT_LIST_ID}>
        {knownIngredients.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id="import-spirits">
        {spiritSuggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <header className={styles.header}>
        <button className={styles.iconBtn} aria-label="Back" onClick={goBack}>
          <ChevronLeftIcon size={26} />
        </button>
        <span className={styles.headTitle}>Import from video</span>
        <span className={styles.headSpacer} />
      </header>

      {!draft ? (
        <div className={styles.body}>
          <div className={styles.intro}>
            <PlayIcon size={26} className={styles.introIcon} />
            <p>
              Copy a cocktail recipe or a video's <strong>description</strong>, and paste it
              below — or <strong>share</strong> a video straight to this app. I'll pull out every
              cocktail (and its syrups) so you can pick which to save.
            </p>
          </div>
          <textarea
            className={styles.paste}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Paste the full video description here…'}
            rows={12}
            autoFocus
          />
          {aiError && (
            <p className={styles.warn}>
              {aiError} <span className={styles.warnDim}>Basic parse still works below.</span>
            </p>
          )}

          {aiEnabled ? (
            <>
              <div className={styles.actions}>
                <button className={styles.ghostBtn} onClick={pasteFromClipboard} disabled={aiBusy}>
                  Paste
                </button>
                <button
                  className={styles.solidBtn}
                  disabled={!text.trim() || aiBusy}
                  onClick={smartParse}
                >
                  <SparkleIcon size={18} /> {aiBusy ? 'Parsing with Gemini…' : 'Smart parse'}
                </button>
              </div>
              <button
                className={styles.textBtn}
                disabled={!text.trim() || aiBusy}
                onClick={parse}
              >
                Use basic parser instead
              </button>
            </>
          ) : (
            <>
              <div className={styles.actions}>
                <button className={styles.ghostBtn} onClick={pasteFromClipboard}>
                  Paste
                </button>
                <button className={styles.solidBtn} disabled={!text.trim()} onClick={parse}>
                  Parse recipe
                </button>
              </div>
              {FEATURES.cloudAI && (
                <Link className={styles.aiNudge} to="/settings">
                  <SparkleIcon size={15} /> Want smarter, multi-drink parsing? Add a Gemini key in
                  Settings
                </Link>
              )}
            </>
          )}
        </div>
      ) : single ? (
        <SinglePreview
          imp={single}
          ok={draft.ok}
          excluded={excluded}
          saving={saving}
          canImport={canImportSingle}
          onPatchMain={patchMain}
          onPatchComponent={patchComponent}
          onPatchIngredients={patchRecipeIngredients}
          onToggleComponent={toggleComponent}
          onStartOver={() => setDraft(null)}
          onImport={doImportSingle}
        />
      ) : (
        <MultiPreview
          recipes={recipes}
          selected={selected}
          saving={saving}
          onToggle={toggleSelected}
          onStartOver={() => setDraft(null)}
          onImport={doImportSelected}
        />
      )}
    </div>
  )
}

// -------------------------------------------------------------------------
// One drink: full editable preview (existing behaviour)
// -------------------------------------------------------------------------
function SinglePreview({
  imp,
  ok,
  excluded,
  saving,
  canImport,
  onPatchMain,
  onPatchComponent,
  onPatchIngredients,
  onToggleComponent,
  onStartOver,
  onImport,
}: {
  imp: StructuredImport
  ok: boolean
  excluded: Set<string>
  saving: boolean
  canImport: boolean
  onPatchMain: (patch: Partial<RecipeDraft>) => void
  onPatchComponent: (tempId: string, patch: Partial<RecipeDraft>) => void
  onPatchIngredients: (tempId: string, ings: IngredientDraft[]) => void
  onToggleComponent: (tempId: string) => void
  onStartOver: () => void
  onImport: () => void
}) {
  const { main, components } = imp
  return (
    <div className={styles.body}>
      {!ok && (
        <p className={styles.warn}>
          I couldn't confidently find a recipe — check the text below and edit as needed, or go
          back and paste again.
        </p>
      )}

      {main.kind === 'component' && (
        <p className={styles.kindNote}>
          <FlaskIcon size={14} /> Detected as a sub-recipe (syrup / cordial)
        </p>
      )}
      <label className={styles.label}>
        {main.kind === 'component' ? 'Sub-recipe name' : 'Cocktail name'}
      </label>
      <input
        className={styles.nameInput}
        value={main.name}
        onChange={(e) => onPatchMain({ name: e.target.value })}
        placeholder="Name"
      />

      <h2 className={styles.h2}>Ingredients</h2>
      <IngredientList recipe={main} onChange={(ings) => onPatchIngredients(main.tempId, ings)} />

      {(main.garnish || main.method) && (
        <p className={styles.meta}>
          {main.method && <span>{main.method}</span>}
          {main.method && main.garnish ? ' · ' : ''}
          {main.garnish && <span>Garnish: {main.garnish}</span>}
        </p>
      )}

      {main.kind !== 'component' && (
        <div className={styles.spiritRow}>
          <label className={styles.spiritLabel}>Base spirit</label>
          <input
            className={styles.spiritInput}
            list="import-spirits"
            value={main.spirit ?? ''}
            onChange={(e) => onPatchMain({ spirit: e.target.value || undefined })}
            placeholder="gin, cachaça…"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </div>
      )}

      {(main.tags?.length ?? 0) > 0 && (
        <div className={styles.chipsRow}>
          {(main.tags ?? []).map((t) => (
            <span key={t} className={styles.tagChip}>
              #{t}
            </span>
          ))}
        </div>
      )}

      {components.length > 0 && (
        <>
          <h2 className={styles.h2}>Sub-recipes found</h2>
          {components.map((c) => {
            const on = !excluded.has(c.tempId)
            return (
              <div key={c.tempId} className={`${styles.compCard} ${on ? '' : styles.compOff}`}>
                <div className={styles.compHead}>
                  <FlaskIcon size={15} className={styles.compFlask} />
                  <input
                    className={styles.compName}
                    value={c.name}
                    onChange={(e) => onPatchComponent(c.tempId, { name: e.target.value })}
                  />
                  <label className={styles.compToggle}>
                    <input type="checkbox" checked={on} onChange={() => onToggleComponent(c.tempId)} />
                    link
                  </label>
                </div>
                {on && (
                  <IngredientList
                    recipe={c}
                    onChange={(ings) => onPatchIngredients(c.tempId, ings)}
                  />
                )}
              </div>
            )
          })}
        </>
      )}

      <div className={styles.actions}>
        <button className={styles.ghostBtn} onClick={onStartOver}>
          Start over
        </button>
        <button className={styles.solidBtn} disabled={!canImport || saving} onClick={onImport}>
          {saving ? 'Importing…' : 'Import recipe'}
        </button>
      </div>
    </div>
  )
}

// -------------------------------------------------------------------------
// Several drinks: checklist to pick which to save
// -------------------------------------------------------------------------
function MultiPreview({
  recipes,
  selected,
  saving,
  onToggle,
  onStartOver,
  onImport,
}: {
  recipes: StructuredImport[]
  selected: Set<number>
  saving: boolean
  onToggle: (idx: number) => void
  onStartOver: () => void
  onImport: () => void
}) {
  const count = selected.size
  return (
    <div className={styles.body}>
      <p className={styles.foundNote}>
        <SparkleIcon size={15} /> {recipes.length} cocktails found — pick which to save.
      </p>

      {recipes.map((imp, i) => {
        const on = selected.has(i)
        const m = imp.main
        return (
          <button
            key={m.tempId}
            type="button"
            className={`${styles.pickCard} ${on ? styles.pickOn : ''}`}
            onClick={() => onToggle(i)}
            aria-pressed={on}
          >
            <span className={`${styles.pickCheck} ${on ? styles.pickCheckOn : ''}`} aria-hidden>
              {on ? '✓' : ''}
            </span>
            <span className={styles.pickBody}>
              <span className={styles.pickName}>
                {m.name || (m.kind === 'component' ? 'Untitled syrup' : 'Untitled drink')}
              </span>
              <span className={styles.pickMeta}>
                {m.kind === 'component' ? (
                  <span className={styles.pickSpirit}>syrup</span>
                ) : m.spirit ? (
                  <span className={styles.pickSpirit}>{m.spirit}</span>
                ) : null}
                <span>
                  {m.ingredients.length} ingredient{m.ingredients.length === 1 ? '' : 's'}
                </span>
                {imp.components.length > 0 && (
                  <span>
                    · {imp.components.length} sub-recipe{imp.components.length === 1 ? '' : 's'}
                  </span>
                )}
              </span>
              <span className={styles.pickIngs}>
                {m.ingredients
                  .map((ing) => ing.name)
                  .filter(Boolean)
                  .slice(0, 5)
                  .join(' · ')}
                {m.ingredients.length > 5 ? ' …' : ''}
              </span>
              {(m.tags?.length ?? 0) > 0 && (
                <span className={styles.pickTags}>{(m.tags ?? []).map((t) => `#${t}`).join(' ')}</span>
              )}
            </span>
          </button>
        )
      })}

      <div className={styles.actions}>
        <button className={styles.ghostBtn} onClick={onStartOver} disabled={saving}>
          Start over
        </button>
        <button className={styles.solidBtn} disabled={count === 0 || saving} onClick={onImport}>
          {saving ? 'Importing…' : count <= 1 ? 'Import recipe' : `Import ${count} recipes`}
        </button>
      </div>
    </div>
  )
}

function IngredientList({
  recipe,
  onChange,
}: {
  recipe: RecipeDraft
  onChange: (ings: IngredientDraft[]) => void
}) {
  const update = (idx: number, patch: Partial<IngredientDraft>) =>
    onChange(recipe.ingredients.map((i, n) => (n === idx ? { ...i, ...patch } : i)))
  const remove = (idx: number) => onChange(recipe.ingredients.filter((_, n) => n !== idx))
  const add = () => onChange([...recipe.ingredients, { amount: null, unit: 'oz', name: '' }])

  return (
    <div className={styles.ings}>
      {recipe.ingredients.map((ing, idx) => (
        <div key={idx} className={styles.ingRow}>
          <input
            className={styles.amt}
            type="number"
            inputMode="decimal"
            step="any"
            value={ing.amount ?? ''}
            onChange={(e) => update(idx, { amount: e.target.value === '' ? null : Number(e.target.value) })}
            placeholder="—"
          />
          <select
            className={styles.unit}
            value={ing.unit}
            onChange={(e) => update(idx, { unit: e.target.value as Unit })}
          >
            {UNIT_ORDER.map((u) => (
              <option key={u} value={u}>
                {UNITS[u].label || u}
              </option>
            ))}
          </select>
          <input
            className={styles.ingName}
            list={INGREDIENT_LIST_ID}
            value={ing.name}
            onChange={(e) => update(idx, { name: e.target.value })}
            placeholder="Ingredient"
          />
          <button className={styles.del} aria-label="Remove" onClick={() => remove(idx)}>
            <TrashIcon size={17} />
          </button>
        </div>
      ))}
      <button className={styles.addRow} onClick={add}>
        <PlusIcon size={16} /> Add
      </button>
    </div>
  )
}
