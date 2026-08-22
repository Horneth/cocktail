import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { ChevronLeftIcon, FlaskIcon, PlusIcon, SparkleIcon, TrashIcon, UploadIcon } from '../components/icons'
import { FEATURES, isCloudAIConfigured } from '../config'
import type { Ingredient, MeasureBasis, Recipe, RecipeKind, Unit } from '../db/schema'
import { newId } from '../domain/ids'
import { shortlistCandidates } from '../domain/dupeMatch'
import { KIND_LABELS, RECIPE_KINDS } from '../domain/recipeKind'
import { KNOWN_SPIRITS } from '../domain/spirits'
import { spiritVisual } from '../domain/spiritVisual'
import { UNIT_ORDER, UNITS } from '../domain/units'
import { GLASSES, METHODS } from '../domain/vocab'
import { deleteRecipe, saveRecipe } from '../import/importRecipe'
import { downscaleDataUrl } from '../import/image'
import {
  bundleImageUrl,
  catalogImageUrl,
  getMergedCatalog,
  getMergedManifest,
} from '../import/catalogImages'
import bundledManifest from '../domain/recipeImagesManifest.json'
const bundledManifestMap = bundledManifest as Record<string, string>
import { suggestImages } from '../domain/recipeImage'
import type { CocktailImage } from '../domain/recipeImages'
import type { GuessedField, StructuredImport } from '../import/types'
import { consumeSharedImport } from '../import/shared'
import { useAuth } from '../hooks/useAuth'
import {
  useKnownIngredients,
  useMixers,
  useRecipe,
  useRecipeNameIndex,
  useSpiritSuggestions,
} from '../hooks/useRecipes'
import styles from './EditRecipeScreen.module.css'

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
    measureBasis: kind === 'cocktail' ? 'absolute' : 'parts',
    baseServings: 1,
    tags: [],
    notes: [],
    createdAt: now,
    updatedAt: now,
  }
}

// Whether this build ships the AI at all. The autofill affordance renders only
// when it does; sign-in (and the SDK boot) still waits for a tap on it.
const aiInBuild = FEATURES.cloudAI && isCloudAIConfigured()

/**
 * The one recipe editor — the same screen for a drink you type by hand, edit,
 * or let a pasted description fill in. Manual entry is the default and needs
 * nothing; "paste to fill this in" (when AI is configured) is a head start that
 * lands in the exact same fields, which are still yours to correct. This screen
 * is what /new, /recipe/:id/edit and the Android share target all arrive at.
 */
export function EditRecipeScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isNew = !id
  const existing = useRecipe(id)
  const mixers = useMixers()
  const knownIngredients = useKnownIngredients()
  const spiritSuggestions = useSpiritSuggestions()
  const nameIndex = useRecipeNameIndex()
  const auth = useAuth()

  const [form, setForm] = useState<Recipe | null>(isNew ? emptyRecipe('cocktail') : null)
  const [tagInput, setTagInput] = useState('')
  // Which fields were inferred rather than typed, so the user can see at a glance
  // what the AI decided rather than read. Cleared the moment you edit that field.
  const [guessed, setGuessed] = useState<Set<GuessedField>>(new Set())
  // A local, on-device "you already have something like this" nudge after a
  // paste — so filling in a Daiquiri you own doesn't quietly double your library.
  const [dupe, setDupe] = useState<{ name: string; id: string } | null>(null)
  const [aiFilled, setAiFilled] = useState(false)

  // AI "paste to fill" state.
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteBusy, setPasteBusy] = useState(false)
  const [pasteError, setPasteError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<StructuredImport[] | null>(null)

  // ── Image state (pick / generate) ──
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)

  useEffect(() => {
    if (!isNew && existing && !form) {
      setForm(structuredClone(existing))
      setTagInput(existing.tags.join(', '))
    }
  }, [existing, isNew, form])

  // The Android share target (main.tsx stashes the text before React mounts and
  // the shell routes here). Prefill the paste box, and for a YouTube link go
  // ahead and fill the form — no second tap.
  const sharedApplied = useRef(false)
  useEffect(() => {
    if (sharedApplied.current || !isNew || parsed || !auth.ready) return
    const shared = consumeSharedImport()
    if (!shared) return
    sharedApplied.current = true
    if (auth.aiAvailable) {
      setPasteOpen(true)
      setPasteText(shared.text)
      if (shared.auto) void extract(shared.text)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, parsed, auth.ready, auth.aiAvailable])

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

  // ── Image: pick a photo, or pick the closest curated catalog shot ──
  const onPickImage = async (file: File | undefined) => {
    if (!file || imageBusy) return
    setImageBusy(true)
    setImageError(null)
    try {
      const url = await downscaleDataUrl(file)
      update({ image: url, imageStatus: 'done' })
    } catch {
      setImageError('Could not read that photo.')
    } finally {
      setImageBusy(false)
    }
  }

  // Suggestions: the closest curated catalog shots for the drink as it's being
  // edited. Recomputes as the form changes (name/spirit/glass/garnish/tags).
  const [suggestions, setSuggestions] = useState<CocktailImage[]>([])
  useEffect(() => {
    if (!form || form.kind !== 'cocktail') {
      setSuggestions([])
      return
    }
    let alive = true
    void (async () => {
      const [catalog, manifest] = await Promise.all([getMergedCatalog(), getMergedManifest()])
      if (!alive) return
      const hits = suggestImages(form, 4, catalog)
      // Keep only slots that have a resolvable image (bundled or Storage).
      const resolvable = hits.filter((h) => manifest[h.slot.slug])
      setSuggestions(resolvable.map((h) => h.slot))
    })()
    return () => {
      alive = false
    }
  }, [form?.name, form?.spirit, form?.glassware, form?.garnish, form?.tags, form?.ingredients])

  const pickSuggestion = async (slug: string) => {
    const url = await catalogImageUrl(slug)
    if (url) update({ image: url, imageStatus: 'done' })
  }

  const suggestionThumb = (slug: string): string => {
    const file = bundledManifestMap[slug]
    return file ? bundleImageUrl(file) : ''
  }

  const isCocktailKind = form.kind === 'cocktail'
  const currentSpirit = form.spirit?.trim().toLowerCase()

  // ── AI: paste to fill ──────────────────────────────────────────────────────
  const extract = async (source: string) => {
    if (pasteBusy) return
    setPasteBusy(true)
    setPasteError(null)
    try {
      const { firebaseParse } = await import('../import/firebaseAI')
      const drafts = await firebaseParse(source)
      setParsed(drafts)
      if (drafts.length === 1) fillFrom(drafts[0])
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : 'Could not read that text.')
    } finally {
      setPasteBusy(false)
    }
  }

  /** Load a parsed draft into the same form the user types by hand. */
  const fillFrom = (imp: StructuredImport) => {
    const { main, guessed: g } = imp
    setPasteError(null)

    const ingredients: Ingredient[] = (main.ingredients ?? [])
      .filter((i) => i.name.trim())
      .map((di) => ({
        id: newId(),
        name: di.name.trim(),
        amount: di.amount,
        unit: di.unit,
        ...(di.optional ? { optional: true } : {}),
        ...(di.note ? { note: di.note } : {}),
        ...(di.recipeId ? { recipeId: di.recipeId } : {}),
      }))

    setForm((f) =>
      f
        ? {
            ...f,
            kind: main.kind,
            name: main.name,
            ingredients: ingredients.length ? ingredients : [blankIngredient()],
            measureBasis: main.measureBasis,
            baseServings: main.baseServings ?? 1,
            glassware: main.glassware,
            method: main.method,
            garnish: main.garnish,
            instructions: main.instructions,
            tags: main.tags ?? [],
            spirit: main.spirit,
          }
        : f,
    )
    // An empty name the draft left behind shouldn't clear the user's edit the
    // next render; tags come from the draft unless the user already typed.
    setTagInput((prev) => (prev === '' && main.tags ? main.tags.join(', ') : prev))
    setGuessed(new Set(g ?? []))
    setAiFilled(true)
    setPasteOpen(false)
    setParsed(null)
    setPasteText('')
    // A same-or-near name gets a local heads-up (no cloud round-trip): the
    // obvious save shouldn't silently create a duplicate.
    setDupe(shortlistCandidates(imp.main.name, imp.aka ?? [], nameIndex, main.kind)[0] ?? null)
  }

  const clearGuess = (field: GuessedField) =>
    setGuessed((prev) => {
      if (!prev.has(field)) return prev
      const next = new Set(prev)
      next.delete(field)
      return next
    })

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button className={styles.back} aria-label="Cancel" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={20} />
        </button>
        <h1 className={styles.title}>{isNew ? 'New recipe' : 'Edit recipe'}</h1>
      </header>

      <div className={styles.body}>
        {aiInBuild && (
          <button className={styles.pasteBtn} onClick={() => setPasteOpen(true)} aria-label="Import; paste a recipe to fill this in">
            <SparkleIcon size={16} />
            Import
            <span className={styles.legacyLabel}>Paste a recipe to fill this in</span>
          </button>
        )}
        {aiFilled && <p className={styles.aiNote}><SparkleIcon size={15} /> Filled from a photo — check it before saving.</p>}

        {(form.image || isNew) && (
          <div className={styles.imageBlock}>
            {form.image ? (
              <>
                <img className={styles.imagePreview} src={form.image} alt={form.name || 'Recipe photo'} />
                <div className={styles.imageActions}>
                  <button className={styles.imageBtn} onClick={() => update({ image: undefined, imageStatus: undefined })}>
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <>
                {isCocktailKind && suggestions.length > 0 && (
                  <div className={styles.suggestBlock}>
                    <div className={styles.suggestLabel}>Suggested photos</div>
                    <div className={styles.suggestRow}>
                      {suggestions.map((s) => (
                        <button
                          key={s.slug}
                          className={styles.suggestThumb}
                          onClick={() => void pickSuggestion(s.slug)}
                          aria-label={`Use the ${s.label} photo`}
                        >
                          <img src={suggestionThumb(s.slug)} alt="" />
                          <span>{s.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div className={styles.imageAddRow}>
                  <label className={styles.imagePick}>
                    <UploadIcon size={15} />
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        void onPickImage(e.target.files?.[0])
                        e.target.value = ''
                      }}
                    />
                    Choose a photo
                  </label>
                </div>
              </>
            )}
            {imageError && <p className={styles.imageError}>{imageError}</p>}
          </div>
        )}

        <label className={styles.label}>Name</label>
        <div className={styles.inputCard}>
          <input
            className={styles.nameInput}
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={!isCocktailKind ? 'e.g. Rich Simple Syrup' : 'e.g. Midnight Sour'}
            autoFocus={isNew && !pasteOpen}
          />
        </div>

        <div className={styles.segment}>
          {RECIPE_KINDS.map((k) => (
            <button
              key={k}
              className={`${styles.segBtn} ${form.kind === k ? styles.segActive : ''}`}
              onClick={() => {
                // A syrup/cordial is an ingredient, not a serve — switching to
                // one drops the fields that only make sense for a drink.
                update(
                  k === 'cocktail'
                    ? { kind: k }
                    : {
                        kind: k,
                        measureBasis: 'parts',
                        spirit: undefined,
                        glassware: undefined,
                        garnish: undefined,
                        method: undefined,
                      },
                )
                clearGuess('kind')
              }}
            >
              {KIND_LABELS[k]}
              {guessed.has('kind') && form.kind === k && <GuessMark />}
            </button>
          ))}
        </div>

        {isCocktailKind && (
          <>
            <div className={styles.labelRow}>
              <label className={styles.label}>Base spirit</label>
              {guessed.has('spirit') && <GuessMark />}
            </div>
            <div className={`${styles.chipRow} hg-scroll`}>
              {KNOWN_SPIRITS.map((k) => {
                const v = spiritVisual(k)
                return (
                  <button
                    key={k}
                    className={`${styles.spiritChip} ${currentSpirit === k ? styles.spiritChipOn : ''}`}
                    onClick={() => {
                      update({ spirit: currentSpirit === k ? undefined : k })
                      clearGuess('spirit')
                    }}
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
              linkable={mixers ?? []}
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

        {isCocktailKind && (
          <>
            <label className={styles.label}>Build</label>
            <div className={styles.grid2}>
              <Field
                label="Spirit (custom)"
                guessed={guessed.has('spirit')}
                onTouched={() => clearGuess('spirit')}
              >
                <input
                  list="spirit-suggestions"
                  value={form.spirit ?? ''}
                  onChange={(e) => {
                    update({ spirit: e.target.value || undefined })
                    clearGuess('spirit')
                  }}
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
              <Field label="Method" guessed={guessed.has('method')} onTouched={() => clearGuess('method')}>
                <select
                  value={form.method ?? ''}
                  onChange={(e) => {
                    update({ method: e.target.value || undefined })
                    clearGuess('method')
                  }}
                >
                  <option value="">—</option>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Glass" guessed={guessed.has('glassware')} onTouched={() => clearGuess('glassware')}>
                <input
                  list="glass-suggestions"
                  value={form.glassware ?? ''}
                  onChange={(e) => {
                    update({ glassware: e.target.value || undefined })
                    clearGuess('glassware')
                  }}
                  placeholder="Coupe, Rocks…"
                />
                <datalist id="glass-suggestions">
                  {GLASSES.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </Field>
              <Field label="Garnish" guessed={guessed.has('garnish')} onTouched={() => clearGuess('garnish')}>
                <input
                  value={form.garnish ?? ''}
                  onChange={(e) => {
                    update({ garnish: e.target.value || undefined })
                    clearGuess('garnish')
                  }}
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

        <div className={styles.labelRow}>
          <label className={styles.label}>Tags</label>
          {guessed.has('tags') && <GuessMark />}
        </div>
        <div className={styles.inputCard}>
          <input
            className={styles.nameInput}
            value={tagInput}
            onChange={(e) => {
              setTagInput(e.target.value)
              clearGuess('tags')
            }}
            placeholder="sour, tiki, citrusy (comma-separated)"
          />
        </div>

        {guessed.size > 0 && <p className={styles.legend}>✨ guessed — edit to keep what’s yours</p>}

        {dupe && (
          <div className={styles.dupe}>
            You already have{' '}
            <Link className={styles.dupeLink} to={`/recipe/${dupe.id}`}>
              {dupe.name || 'something similar'}
            </Link>{' '}
            — check it before you save a copy.
          </div>
        )}

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

      <PasteSheet
        open={pasteOpen}
        onClose={() => {
          setPasteOpen(false)
          setParsed(null)
          setPasteError(null)
        }}
        parsed={parsed}
        text={pasteText}
        setText={setPasteText}
        busy={pasteBusy}
        error={pasteError}
        onExtract={(t) => void extract(t)}
        onChoose={(imp) => void fillFrom(imp)}
        onReset={() => {
          setParsed(null)
          setPasteError(null)
          setPasteText('')
        }}
        auth={auth}
      />
    </div>
  )
}

// The "the AI made this up" mark. Labelled, so it isn't just a sparkle to a
// screen reader.
function GuessMark() {
  return (
    <span className={styles.guessMark} title="Guessed from pasted text — edit to change" aria-label="guessed">
      ✨
    </span>
  )
}

function Field({
  label,
  guessed,
  onTouched,
  children,
}: {
  label: string
  guessed?: boolean
  onTouched?: () => void
  children: React.ReactNode
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabelRow}>
        <span className={styles.fieldLabel}>{label}</span>
        {guessed && <GuessMark />}
      </span>
      <div onFocus={onTouched}>{children}</div>
    </label>
  )
}

interface PasteSheetProps {
  open: boolean
  onClose: () => void
  parsed: StructuredImport[] | null
  text: string
  setText: (t: string) => void
  busy: boolean
  error: string | null
  onExtract: (text: string) => void
  onChoose: (imp: StructuredImport) => void
  onReset: () => void
  auth: ReturnType<typeof useAuth>
}

function PasteSheet({
  open,
  onClose,
  parsed,
  text,
  setText,
  busy,
  error,
  onExtract,
  onChoose,
  onReset,
  auth,
}: PasteSheetProps) {
  const gust = (imp: StructuredImport) => {
    const parts: string[] = []
    if (imp.main.kind !== 'cocktail' || (imp.guessed && imp.guessed.length)) parts.push('✨')
    if (imp.main.spirit) parts.push(String(imp.main.spirit))
    if (imp.main.ingredients.length) parts.push(`${imp.main.ingredients.length} ingredients`)
    return parts.join(' · ')
  }

  return (
    <BottomSheet open={open} onClose={onClose} draggable>
      <div className={styles.sheetHead}>
        <h2 className={styles.sheetHeadTitle}>Fill this form from text</h2>
      </div>

      {!auth.ready ? (
        <p className={styles.pasteMuted}>…</p>
      ) : !auth.aiAvailable ? (
        <>
          <p className={styles.pasteMuted}>
            Filling a recipe from a pasted description runs through Google’s AI.
            Everything else works signed out.
          </p>
          <button className={styles.pasteSignIn} onClick={() => void auth.signIn()}>
            <SparkleIcon size={16} /> Sign in with Google
          </button>
        </>
      ) : parsed ? (
        <div className={styles.pasteResults}>
          {parsed.length === 0 ? (
            <p className={styles.pasteMuted}>Nothing to fill from that text.</p>
          ) : (
            <>
              <p className={styles.pasteMuted}>
                {parsed.length === 1 ? 'One recipe found.' : `Which one should fill this form?`}
              </p>
              {parsed.map((imp) => (
                <button key={imp.main.tempId} className={styles.pasteRow} onClick={() => onChoose(imp)}>
                  <span className={styles.pasteRowName}>{imp.main.name || 'Untitled'}</span>
                  <span className={styles.pasteRowSub}>{gust(imp)}</span>
                </button>
              ))}
              <button className={styles.pasteReset} onClick={onReset}>
                Start over
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          <textarea
            className={styles.pasteTextarea}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste recipe here (paste a recipe)"
            rows={5}
            autoFocus
          />
          {error && <p className={styles.pasteError}>{error}</p>}
          <div className={styles.pasteActions}>
            <button className={styles.pasteCancel} onClick={onClose}>
              Cancel
            </button>
            <button
              className={`${styles.pasteGo} ${text.trim() ? '' : styles.pasteGoOff}`}
              disabled={!text.trim() || busy}
              onClick={() => onExtract(text)}
            >
              <SparkleIcon size={16} />
              {busy ? 'Reading…' : 'Fill this form'}
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}

interface IngEditorProps {
  ingredient: Ingredient
  /** existing recipes this ingredient can link to (syrups & cordials) */
  linkable: Recipe[]
  knownNames: string[]
  currentRecipeId: string
  onChange: (patch: Partial<Ingredient>) => void
  onRemove: () => void
}

function IngredientEditor({
  ingredient,
  linkable,
  knownNames,
  currentRecipeId,
  onChange,
  onRemove,
}: IngEditorProps) {
  const [focused, setFocused] = useState(false)

  // Autocomplete: as you type an ingredient name, offer the recipes it could BE.
  // Linking is a deliberate tap, never an auto-create — import/creation never
  // invents a recipe, this is the only place a cross-link gets made.
  const suggestions = useMemo(() => {
    const q = ingredient.name.trim().toLowerCase()
    if (!q) return []
    return linkable
      .filter((c) => c.id !== currentRecipeId && c.name.toLowerCase().includes(q))
      .slice(0, 4)
  }, [linkable, ingredient.name, currentRecipeId])

  const nameMatches = useMemo(() => {
    const q = ingredient.name.trim().toLowerCase()
    if (!q) return []
    const recipeNames = new Set(linkable.map((c) => c.name.toLowerCase()))
    return knownNames
      .filter((n) => {
        const l = n.toLowerCase()
        return l.includes(q) && l !== q && !recipeNames.has(l)
      })
      .slice(0, 5)
  }, [knownNames, ingredient.name, linkable])

  const linkedRecipe = useMemo(
    () => linkable.find((c) => c.id === ingredient.recipeId),
    [linkable, ingredient.recipeId],
  )
  const showLinkOptions = !ingredient.recipeId

  const pickName = (name: string) => {
    onChange({ name, recipeId: undefined })
    setFocused(false)
  }
  const linkTo = (recipe: Recipe) => {
    onChange({ name: recipe.name, recipeId: recipe.id })
    setFocused(false)
  }

  const showDropdown =
    focused &&
    ingredient.name.trim() !== '' &&
    (nameMatches.length > 0 || (showLinkOptions && suggestions.length > 0))

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
          className={ingredient.recipeId ? styles.nameLinked : ''}
          value={ingredient.name}
          onChange={(e) => onChange({ name: e.target.value, recipeId: undefined })}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Ingredient name"
        />
        {linkedRecipe && (
          <span className={styles.linkBadge}>
            <FlaskIcon size={13} /> {KIND_LABELS[linkedRecipe.kind]}
          </span>
        )}

        {showDropdown && (
          <div className={styles.dropdown}>
            {showLinkOptions &&
              suggestions.map((c) => (
                <button key={c.id} className={styles.suggestion} onMouseDown={() => linkTo(c)}>
                  {c.name}
                </button>
              ))}
            {nameMatches.map((n) => (
              <button key={n} className={styles.suggestion} onMouseDown={() => pickName(n)}>
                {n}
              </button>
            ))}
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