import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SparkleIcon, TrashIcon } from '../components/icons'
import type { Unit } from '../db/schema'
import { shortlistCandidates } from '../domain/dupeMatch'
import type { NameIndexEntry } from '../domain/dupeMatch'
import { KIND_EMOJI, KIND_LABELS, RECIPE_KINDS } from '../domain/recipeKind'
import { UNIT_ORDER, UNITS } from '../domain/units'
import { GLASSES, METHODS, TAG_KEYS, tagEmoji } from '../domain/vocab'
import { importRecipe } from '../import/importRecipe'
import type { DupeQuery, DupeRelation } from '../import/aiShared'
import type { GuessedField, IngredientDraft, RecipeDraft, StructuredImport } from '../import/types'
import { consumeSharedImport } from '../import/shared'
import { useKnownIngredients, useRecipeNameIndex, useSpiritSuggestions } from '../hooks/useRecipes'
import { useAuth } from '../hooks/useAuth'
import styles from './ImportScreen.module.css'

const INGREDIENT_LIST_ID = 'known-ingredients'
const SPIRIT_LIST_ID = 'import-spirits'
const GLASS_LIST_ID = 'import-glasses'

const EXAMPLE = `Whiskey Sour
2 oz bourbon
3/4 oz lemon juice
3/4 oz simple syrup
Shake with ice, strain into a coupe.`

/** A library recipe the AI judged related to one we're about to import. */
interface DupeInfo {
  relation: Exclude<DupeRelation, 'different'>
  id: string
  name: string
  reason?: string
}

export function ImportScreen() {
  const navigate = useNavigate()
  const knownIngredients = useKnownIngredients()
  const spiritSuggestions = useSpiritSuggestions()
  const nameIndex = useRecipeNameIndex()
  const auth = useAuth()

  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<StructuredImport[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<number | null>(null)
  const [dupes, setDupes] = useState<Map<number, DupeInfo>>(new Map())
  const [dupeBusy, setDupeBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The extract can be kicked off by an effect (Android share), so read the live
  // name index through a ref rather than closing over a possibly-stale render.
  const indexRef = useRef<NameIndexEntry[]>(nameIndex)
  indexRef.current = nameIndex

  /**
   * Duplicate detection, second phase. Runs AFTER the preview is on screen and
   * writes badges in when it lands — a slow or failed check must never hold up
   * a user who already knows what they pasted.
   */
  const checkDuplicates = async (recipes: StructuredImport[]) => {
    const index = indexRef.current
    const queries: DupeQuery[] = []
    const shortlists = new Map<number, NameIndexEntry[]>()

    recipes.forEach((imp, i) => {
      const aka = imp.aka ?? []
      const candidates = shortlistCandidates(imp.main.name, aka, index, imp.main.kind)
      if (!candidates.length) return
      shortlists.set(i, candidates)
      queries.push({ index: i, name: imp.main.name, aka, candidates: candidates.map((c) => c.name) })
    })
    if (!queries.length) return

    setDupeBusy(true)
    try {
      const { firebaseJudgeDuplicates } = await import('../import/firebaseAI')
      const verdicts = await firebaseJudgeDuplicates(queries)
      const found = new Map<number, DupeInfo>()
      for (const v of verdicts) {
        if (v.relation === 'different') continue
        const entry = shortlists.get(v.index)?.find((c) => c.name === v.match)
        if (!entry) continue
        found.set(v.index, {
          relation: v.relation,
          id: entry.id,
          name: entry.name,
          reason: v.reason,
        })
      }
      setDupes(found)
      // A recipe we already own starts unchecked, so the obvious action (hit
      // Import) can't quietly create a second copy. A named riff is its own
      // recipe and stays checked — we're only labelling it.
      setSelected((prev) => {
        const next = new Set(prev)
        for (const [i, d] of found) if (d.relation === 'same') next.delete(i)
        return next
      })
    } catch {
      // `firebaseJudgeDuplicates` swallows its own failures, but loading the
      // chunk at all can fail (the classic: offline, and it was never cached).
      // Either way the preview is already on screen — it just goes unbadged.
    } finally {
      setDupeBusy(false)
    }
  }

  const extract = async (source: string) => {
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      const { firebaseParse } = await import('../import/firebaseAI')
      const recipes = await firebaseParse(source)
      setDrafts(recipes)
      setDupes(new Map())
      setSelected(new Set(recipes.map((_, i) => i)))
      setExpanded(recipes.length === 1 ? 0 : null)
      void checkDuplicates(recipes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that text.')
    } finally {
      setBusy(false)
    }
  }

  // Android share target: main.tsx stashes the shared text before React mounts.
  // Wait for `ready` — a returning user's session is still being restored on the
  // first render, and extracting before then would look like a signed-out user.
  const sharedApplied = useRef(false)
  useEffect(() => {
    if (sharedApplied.current || drafts || !auth.ready) return
    const shared = consumeSharedImport()
    if (!shared) return
    sharedApplied.current = true
    setText(shared.text)
    // `auto` is false for anything that isn't a YouTube link — it lands in the
    // box and waits for Extract, so no other app can spend a call on our quota.
    if (shared.auto && auth.aiAvailable) void extract(shared.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ready, auth.aiAvailable])

  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/')
  }

  const recipes = drafts ?? []

  const patchAt = (i: number, fn: (imp: StructuredImport) => StructuredImport) =>
    setDrafts((d) => (d ? d.map((imp, n) => (n === i ? fn(imp) : imp)) : d))

  /** Patch the main recipe. `clears` un-marks a guessed field the user just fixed. */
  const editMain = (i: number, patch: Partial<RecipeDraft>, clears?: GuessedField) =>
    patchAt(i, (imp) => ({
      ...imp,
      main: { ...imp.main, ...patch },
      guessed: clears ? imp.guessed?.filter((g) => g !== clears) : imp.guessed,
    }))

  const setKind = (i: number, kind: RecipeDraft['kind']) =>
    editMain(
      i,
      // A syrup/cordial is an ingredient, not a serve — drop the fields that only
      // make sense for a drink rather than leaving stale ones on the record.
      kind === 'cocktail'
        ? { kind }
        : { kind, spirit: undefined, glassware: undefined, garnish: undefined, method: undefined },
      'kind',
    )

  const toggleTag = (i: number, tag: string) =>
    patchAt(i, (imp) => {
      const tags = imp.main.tags ?? []
      return {
        ...imp,
        main: {
          ...imp.main,
          tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag],
        },
        guessed: imp.guessed?.filter((g) => g !== 'tags'),
      }
    })

  const patchIngredients = (i: number, ings: IngredientDraft[]) =>
    patchAt(i, (imp) => ({ ...imp, main: { ...imp.main, ingredients: ings } }))

  const toggleIn = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set)
    if (!next.delete(value)) next.add(value)
    return next
  }
  const toggleSelected = (i: number) => setSelected((prev) => toggleIn(prev, i))

  const importable = useMemo(
    () =>
      new Set(
        recipes
          .map((imp, i) => (imp.main.name.trim() && imp.main.ingredients.some((g) => g.name.trim()) ? i : -1))
          .filter((i) => i >= 0),
      ),
    [recipes],
  )
  const chosen = [...selected].filter((i) => importable.has(i)).sort((a, b) => a - b)

  const cleanImport = (imp: StructuredImport): StructuredImport => ({
    main: {
      ...imp.main,
      name: imp.main.name.trim(),
      ingredients: imp.main.ingredients.filter((g) => g.name.trim()),
      source: { ...imp.main.source, type: imp.main.source?.type ?? 'web', importedAt: Date.now() },
    },
  })

  const doImport = async () => {
    if (saving || !chosen.length) return
    setSaving(true)
    try {
      let lastId = ''
      for (const i of chosen) {
        lastId = await importRecipe(cleanImport(recipes[i]))
      }
      if (chosen.length === 1) navigate(`/recipe/${lastId}`, { replace: true })
      else navigate('/', { replace: true })
    } finally {
      setSaving(false)
    }
  }

  const hasText = text.trim().length > 0

  return (
    <div className={styles.screen}>
      <datalist id={INGREDIENT_LIST_ID}>
        {knownIngredients.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id={SPIRIT_LIST_ID}>
        {spiritSuggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <datalist id={GLASS_LIST_ID}>
        {GLASSES.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>

      <header className={styles.header}>
        <button className={styles.back} aria-label="Back" onClick={goBack}>
          <ChevronLeftIcon size={20} />
        </button>
        <h1 className={styles.title}>Import</h1>
      </header>

      {drafts ? (
        <div className={styles.body}>
          {recipes.length > 1 && (
            <p className={styles.foundNote}>
              <SparkleIcon size={15} /> {recipes.length} recipes found
            </p>
          )}

          {recipes.map((imp, i) => (
            <RecipeCard
              key={imp.main.tempId}
              imp={imp}
              collapsible={recipes.length > 1}
              open={expanded === i}
              selected={selected.has(i)}
              dupe={dupes.get(i)}
              onOpen={() => setExpanded(expanded === i ? null : i)}
              onSelect={() => toggleSelected(i)}
              onPatchMain={(patch, clears) => editMain(i, patch, clears)}
              onSetKind={(kind) => setKind(i, kind)}
              onToggleTag={(tag) => toggleTag(i, tag)}
              onPatchIngredients={(ings) => patchIngredients(i, ings)}
            />
          ))}

          {dupeBusy && <p className={styles.dupeBusy}>Checking your library…</p>}

          <div className={styles.previewActions}>
            <button className={styles.ghostBtn} disabled={saving} onClick={() => setDrafts(null)}>
              Start over
            </button>
            <button
              className={styles.solidBtn}
              disabled={!chosen.length || saving}
              onClick={() => void doImport()}
            >
              {saving ? 'Saving…' : chosen.length > 1 ? `Import ${chosen.length}` : 'Import'}
            </button>
          </div>
        </div>
      ) : !auth.configured ? (
        <div className={styles.body}>
          <div className={styles.gate}>
            <p className={styles.gateTitle}>Import isn’t available in this build</p>
            <p className={styles.gateText}>It needs a configured AI project.</p>
            <Link className={styles.gateGhost} to="/new">
              Add a recipe by hand
            </Link>
          </div>
        </div>
      ) : !auth.ready ? (
        <div className={styles.body} />
      ) : !auth.aiAvailable ? (
        <div className={styles.body}>
          <div className={styles.gate}>
            <SparkleIcon size={26} className={styles.gateIcon} />
            <p className={styles.gateTitle}>Sign in to import</p>
            <p className={styles.gateText}>
              Import runs through Google’s AI. Everything else works signed out.
            </p>
            <button className={styles.gateBtn} onClick={() => void auth.signIn()}>
              Sign in with Google
            </button>
            <Link className={styles.gateGhost} to="/new">
              Add a recipe by hand
            </Link>
          </div>
        </div>
      ) : (
        <div className={styles.body}>
          <div className={styles.textareaCard}>
            <textarea
              className={styles.textarea}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste a recipe, or a whole video description…"
              autoFocus
            />
          </div>

          <button className={styles.example} onClick={() => setText(EXAMPLE)}>
            Paste an example
          </button>

          {error && <p className={styles.warn}>{error}</p>}

          <div className={styles.ctaWrap}>
            <button
              className={`${styles.cta} ${hasText ? '' : styles.ctaOff}`}
              disabled={!hasText || busy}
              onClick={() => void extract(text)}
            >
              <SparkleIcon size={19} />
              {busy ? 'Reading…' : hasText ? 'Extract recipe' : 'Paste something to start'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Review card ────────────────────────────────────────────────────────────

function RecipeCard({
  imp,
  collapsible,
  open,
  selected,
  dupe,
  onOpen,
  onSelect,
  onPatchMain,
  onSetKind,
  onToggleTag,
  onPatchIngredients,
}: {
  imp: StructuredImport
  collapsible: boolean
  open: boolean
  selected: boolean
  dupe?: DupeInfo
  onOpen: () => void
  onSelect: () => void
  onPatchMain: (patch: Partial<RecipeDraft>, clears?: GuessedField) => void
  onSetKind: (kind: RecipeDraft['kind']) => void
  onToggleTag: (tag: string) => void
  onPatchIngredients: (ings: IngredientDraft[]) => void
}) {
  const { main } = imp
  const isCocktailKind = main.kind === 'cocktail'
  const guessed = new Set(imp.guessed ?? [])
  const tags = main.tags ?? []
  // Selected tags first so the row opens on what's already chosen; the rest of
  // the vocabulary scrolls in behind them.
  const tagChoices = [...tags, ...TAG_KEYS.filter((t) => !tags.includes(t))]
  const body = open || !collapsible

  return (
    <div className={`${styles.card} ${collapsible && selected ? styles.cardOn : ''}`}>
      {collapsible && (
        <div className={styles.cardHead}>
          <button
            className={`${styles.check} ${selected ? styles.checkOn : ''}`}
            aria-label={selected ? 'Deselect' : 'Select'}
            aria-pressed={selected}
            onClick={onSelect}
          >
            {selected ? '✓' : ''}
          </button>
          <button className={styles.cardTitle} onClick={onOpen} aria-expanded={open}>
            <span className={styles.cardName}>{main.name || 'Untitled'}</span>
            <span className={styles.cardMeta}>
              {isCocktailKind ? main.spirit ?? 'cocktail' : KIND_LABELS[main.kind].toLowerCase()} ·{' '}
              {main.ingredients.length} ingredient{main.ingredients.length === 1 ? '' : 's'}
              {dupe && (
                <span className={dupe.relation === 'same' ? styles.pillSame : styles.pillVariation}>
                  {dupe.relation === 'same' ? 'already saved' : 'variation'}
                </span>
              )}
            </span>
          </button>
          <ChevronRightIcon
            size={20}
            className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
          />
        </div>
      )}

      {body && (
        <div className={collapsible ? styles.cardBody : undefined}>
          {dupe && (
            <div
              className={`${styles.dupe} ${dupe.relation === 'same' ? styles.dupeSame : styles.dupeVariation}`}
            >
              <strong>
                {dupe.relation === 'same' ? 'Already in your library' : 'Variation of'}
              </strong>{' '}
              <Link className={styles.dupeLink} to={`/recipe/${dupe.id}`}>
                {dupe.name}
              </Link>
              {dupe.reason && <span className={styles.dupeReason}> — {dupe.reason}</span>}
            </div>
          )}

          <div className={styles.segment}>
            {RECIPE_KINDS.map((k) => (
              <button
                key={k}
                className={`${styles.segBtn} ${main.kind === k ? styles.segActive : ''}`}
                onClick={() => onSetKind(k)}
              >
                {KIND_EMOJI[k]} {KIND_LABELS[k]}
                {guessed.has('kind') && main.kind === k && <GuessMark />}
              </button>
            ))}
          </div>

          <div className={styles.inputCard}>
            <input
              className={styles.nameInput}
              value={main.name}
              onChange={(e) => onPatchMain({ name: e.target.value })}
              placeholder="Name"
            />
          </div>

          <IngredientList
            recipe={main}
            onChange={onPatchIngredients}
          />

          <div className={styles.grid2}>
            {isCocktailKind && (
              <Field label="Build" guessed={guessed.has('method')}>
                <select
                  value={main.method ?? ''}
                  onChange={(e) => onPatchMain({ method: e.target.value || undefined }, 'method')}
                >
                  <option value="">—</option>
                  {METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {isCocktailKind && (
              <Field label="Glass" guessed={guessed.has('glassware')}>
                <input
                  list={GLASS_LIST_ID}
                  value={main.glassware ?? ''}
                  onChange={(e) =>
                    onPatchMain({ glassware: e.target.value || undefined }, 'glassware')
                  }
                  placeholder="Coupe…"
                />
              </Field>
            )}
            {isCocktailKind && (
              <Field label="Spirit" guessed={guessed.has('spirit')}>
                <input
                  list={SPIRIT_LIST_ID}
                  value={main.spirit ?? ''}
                  onChange={(e) => onPatchMain({ spirit: e.target.value || undefined }, 'spirit')}
                  placeholder="gin, cachaça…"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
              </Field>
            )}
            {/* last and full-width: garnishes are phrases ("Lime wheel & salt rim"),
                not one-word values like the three above */}
            {isCocktailKind && (
              <Field label="Garnish" guessed={guessed.has('garnish')} wide>
                <input
                  value={main.garnish ?? ''}
                  onChange={(e) => onPatchMain({ garnish: e.target.value || undefined }, 'garnish')}
                  placeholder="Lime wheel…"
                />
              </Field>
            )}
          </div>

          <div className={styles.tagsHead}>
            <span className={styles.label}>Tags</span>
            {guessed.has('tags') && <GuessMark />}
          </div>
          <div className={`${styles.chipRow} hg-scroll`}>
            {tagChoices.map((t) => (
              <button
                key={t}
                className={`${styles.tagChip} ${tags.includes(t) ? styles.tagChipOn : ''}`}
                onClick={() => onToggleTag(t)}
              >
                {tagEmoji(t)} {t}
              </button>
            ))}
          </div>

          {guessed.size > 0 && <p className={styles.legend}>✨ guessed — tap to change</p>}
        </div>
      )}
    </div>
  )
}

/** The "the model made this up" mark. Labelled, so it isn't just a sparkle emoji to a screen reader. */
function GuessMark() {
  return (
    <span className={styles.guessMark} title="Guessed — tap to change" aria-label="guessed">
      ✨
    </span>
  )
}

function Field({
  label,
  guessed,
  wide,
  children,
}: {
  label: string
  guessed: boolean
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={`${styles.field} ${guessed ? styles.fieldGuessed : ''} ${wide ? styles.fieldWide : ''}`}
    >
      <span className={styles.fieldLabel}>
        {label} {guessed && <GuessMark />}
      </span>
      {children}
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
            onChange={(e) =>
              update(idx, { amount: e.target.value === '' ? null : Number(e.target.value) })
            }
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
