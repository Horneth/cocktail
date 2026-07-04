import { useMemo, useState } from 'react'
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
import { parseRecipeText, type ParseResult } from '../import/parseRecipeText'
import type { IngredientDraft, RecipeDraft } from '../import/types'
import { useKnownIngredients } from '../hooks/useRecipes'
import { useGeminiSettings } from '../hooks/useSettings'
import styles from './ImportScreen.module.css'

const INGREDIENT_LIST_ID = 'known-ingredients'

export function ImportScreen() {
  const navigate = useNavigate()
  const knownIngredients = useKnownIngredients()
  const gemini = useGeminiSettings()
  const aiEnabled = FEATURES.cloudAI && gemini.hasKey
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<ParseResult | null>(null)
  const [excluded, setExcluded] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const parse = () => {
    setAiError(null)
    const result = parseRecipeText(text)
    setExcluded(new Set())
    setDraft(result)
  }

  const smartParse = async () => {
    if (aiBusy) return
    setAiError(null)
    setAiBusy(true)
    try {
      const result = await geminiParse(text, gemini.apiKey, gemini.model)
      setExcluded(new Set())
      setDraft({ ...result, ok: true })
    } catch (err) {
      // Fall back gracefully to the offline parser; keep the user on this screen.
      setAiError(err instanceof GeminiError ? err.message : 'AI parse failed. Try Basic parse.')
    } finally {
      setAiBusy(false)
    }
  }

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (t) setText(t)
    } catch {
      /* clipboard blocked — user can paste manually */
    }
  }

  // ---- draft mutation helpers (immutable) ----
  const patchMain = (patch: Partial<RecipeDraft>) =>
    setDraft((d) => (d ? { ...d, main: { ...d.main, ...patch } } : d))

  const patchRecipeIngredients = (tempId: string, ings: IngredientDraft[]) =>
    setDraft((d) => {
      if (!d) return d
      if (d.main.tempId === tempId) return { ...d, main: { ...d.main, ingredients: ings } }
      return {
        ...d,
        components: d.components.map((c) => (c.tempId === tempId ? { ...c, ingredients: ings } : c)),
      }
    })

  const patchComponent = (tempId: string, patch: Partial<RecipeDraft>) =>
    setDraft((d) =>
      d
        ? { ...d, components: d.components.map((c) => (c.tempId === tempId ? { ...c, ...patch } : c)) }
        : d,
    )

  const toggleComponent = (tempId: string) =>
    setExcluded((prev) => {
      const next = new Set(prev)
      next.has(tempId) ? next.delete(tempId) : next.add(tempId)
      return next
    })

  const canImport = useMemo(
    () => !!draft && draft.main.name.trim() !== '' && draft.main.ingredients.some((i) => i.name.trim()),
    [draft],
  )

  const doImport = async () => {
    if (!draft || saving) return
    setSaving(true)
    try {
      const components = draft.components
        .filter((c) => !excluded.has(c.tempId) && c.name.trim() && c.ingredients.length)
        .map((c) => ({ ...c, ingredients: c.ingredients.filter((i) => i.name.trim()) }))
      const main: RecipeDraft = {
        ...draft.main,
        name: draft.main.name.trim(),
        ingredients: draft.main.ingredients.filter((i) => i.name.trim()),
        source: { ...draft.main.source, type: draft.main.source?.type ?? 'web', importedAt: Date.now() },
      }
      const { mainId } = await importRecipe({ main, components })
      navigate(`/recipe/${mainId}`, { replace: true })
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
      <header className={styles.header}>
        <button className={styles.iconBtn} aria-label="Back" onClick={() => navigate(-1)}>
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
              Open an Anders Erickson video, copy its <strong>description</strong>, and paste it
              below. I'll pull out the cocktail and any syrups — cross-linked automatically.
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
                  <SparkleIcon size={15} /> Want smarter parsing? Add a Gemini key in Settings
                </Link>
              )}
            </>
          )}
        </div>
      ) : (
        <div className={styles.body}>
          {!draft.ok && (
            <p className={styles.warn}>
              I couldn't confidently find a recipe — check the text below and edit as needed, or go
              back and paste again.
            </p>
          )}

          <label className={styles.label}>Cocktail name</label>
          <input
            className={styles.nameInput}
            value={draft.main.name}
            onChange={(e) => patchMain({ name: e.target.value })}
            placeholder="Cocktail name"
          />

          <h2 className={styles.h2}>Ingredients</h2>
          <IngredientList
            recipe={draft.main}
            onChange={(ings) => patchRecipeIngredients(draft.main.tempId, ings)}
          />

          {(draft.main.garnish || draft.main.method) && (
            <p className={styles.meta}>
              {draft.main.method && <span>{draft.main.method}</span>}
              {draft.main.method && draft.main.garnish ? ' · ' : ''}
              {draft.main.garnish && <span>Garnish: {draft.main.garnish}</span>}
            </p>
          )}

          {draft.components.length > 0 && (
            <>
              <h2 className={styles.h2}>Sub-recipes found</h2>
              {draft.components.map((c) => {
                const on = !excluded.has(c.tempId)
                return (
                  <div key={c.tempId} className={`${styles.compCard} ${on ? '' : styles.compOff}`}>
                    <div className={styles.compHead}>
                      <FlaskIcon size={15} className={styles.compFlask} />
                      <input
                        className={styles.compName}
                        value={c.name}
                        onChange={(e) => patchComponent(c.tempId, { name: e.target.value })}
                      />
                      <label className={styles.compToggle}>
                        <input type="checkbox" checked={on} onChange={() => toggleComponent(c.tempId)} />
                        link
                      </label>
                    </div>
                    {on && (
                      <IngredientList
                        recipe={c}
                        onChange={(ings) => patchRecipeIngredients(c.tempId, ings)}
                      />
                    )}
                  </div>
                )
              })}
            </>
          )}

          <div className={styles.actions}>
            <button className={styles.ghostBtn} onClick={() => setDraft(null)}>
              Start over
            </button>
            <button className={styles.solidBtn} disabled={!canImport || saving} onClick={doImport}>
              {saving ? 'Importing…' : 'Import recipe'}
            </button>
          </div>
        </div>
      )}
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
