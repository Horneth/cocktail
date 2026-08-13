import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { db } from '../db/db'
import { ImportScreen } from './ImportScreen'
import type { StructuredImport } from '../import/types'
import type { DupeQuery, DupeVerdict } from '../import/aiShared'

// The one screen with a test, because it is the one screen whose correctness is
// about states rather than layout: a sign-in gate, AI-inferred fields the user
// has to be able to see and override, and a duplicate check that must not let a
// second Daiquiri through by accident. smoke.mjs can't reach any of it — it runs
// signed out, where the whole flow is a sign-in wall.

const cloudParse = vi.fn<(text: string) => Promise<StructuredImport[]>>()
const cloudJudgeDuplicates = vi.fn<(queries: DupeQuery[]) => Promise<DupeVerdict[]>>()
vi.mock('../import/cloudAI', () => ({ cloudParse, cloudJudgeDuplicates }))

const auth = {
  user: null as unknown,
  ready: true,
  configured: true,
  aiAvailable: true,
  signIn: vi.fn(),
  signOut: vi.fn(),
}
vi.mock('../hooks/useAuth', () => ({ useAuth: () => auth }))

function draft(name: string, over: Partial<StructuredImport> = {}): StructuredImport {
  return {
    main: {
      tempId: `main-${name}`,
      kind: 'cocktail',
      name,
      measureBasis: 'absolute',
      ingredients: [{ name: 'White rum', amount: 2, unit: 'oz' }],
      method: 'Shake',
      glassware: 'Coupe',
      garnish: 'Lime wheel',
      tags: ['sour'],
      spirit: 'rum',
    },
    components: [],
    ...over,
  }
}

const paste = async (text = 'some recipe text') => {
  const user = userEvent.setup()
  render(
    <MemoryRouter>
      <ImportScreen />
    </MemoryRouter>,
  )
  await user.type(screen.getByRole('textbox'), text)
  await user.click(screen.getByRole('button', { name: /extract recipe/i }))
  return user
}

beforeEach(async () => {
  vi.clearAllMocks()
  cloudJudgeDuplicates.mockResolvedValue([])
  Object.assign(auth, { ready: true, configured: true, aiAvailable: true })
  await db.recipes.clear()
  await db.recipeLinks.clear()
})

describe('the sign-in gate', () => {
  it('offers sign-in and no paste box when signed out', () => {
    Object.assign(auth, { aiAvailable: false })
    render(
      <MemoryRouter>
        <ImportScreen />
      </MemoryRouter>,
    )
    expect(screen.getByText(/sign in to import/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    // the offline way in must stay reachable from the dead end
    expect(screen.getByRole('link', { name: /by hand/i })).toHaveAttribute('href', '/new')
  })

  it('says so plainly when the build has no AI configured at all', () => {
    Object.assign(auth, { configured: false, aiAvailable: false })
    render(
      <MemoryRouter>
        <ImportScreen />
      </MemoryRouter>,
    )
    expect(screen.getByText(/isn’t available in this build/i)).toBeInTheDocument()
    expect(screen.queryByText(/sign in to import/i)).not.toBeInTheDocument()
  })

  it('shows nothing rather than flashing a sign-in wall while a session restores', () => {
    Object.assign(auth, { ready: false, aiAvailable: false })
    render(
      <MemoryRouter>
        <ImportScreen />
      </MemoryRouter>,
    )
    expect(screen.queryByText(/sign in to import/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})

describe('the review card', () => {
  it('shows the recipe and its details, all editable', async () => {
    cloudParse.mockResolvedValue([draft('Daiquiri')])
    await paste()

    expect(await screen.findByDisplayValue('Daiquiri')).toBeInTheDocument()
    expect(screen.getByDisplayValue('White rum')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Coupe')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Lime wheel')).toBeInTheDocument()
    expect(screen.getByDisplayValue('rum')).toBeInTheDocument()
  })

  it('marks only the fields the model inferred, and clears the mark once fixed', async () => {
    cloudParse.mockResolvedValue([draft('Daiquiri', { guessed: ['glassware', 'garnish'] })])
    const user = await paste()

    await screen.findByDisplayValue('Daiquiri')
    expect(screen.getAllByLabelText('guessed')).toHaveLength(2)
    expect(screen.getByText(/guessed — tap to change/i)).toBeInTheDocument()

    await user.type(screen.getByDisplayValue('Coupe'), 'x')
    expect(screen.getAllByLabelText('guessed')).toHaveLength(1)
  })

  it('has no guess marks or legend when everything came from the text', async () => {
    cloudParse.mockResolvedValue([draft('Daiquiri')])
    await paste()

    await screen.findByDisplayValue('Daiquiri')
    expect(screen.queryByLabelText('guessed')).not.toBeInTheDocument()
    expect(screen.queryByText(/guessed — tap to change/i)).not.toBeInTheDocument()
  })

  it('drops the serve fields when a drink is re-marked as a sub-recipe', async () => {
    cloudParse.mockResolvedValue([draft('Simple Syrup')])
    const user = await paste()

    await screen.findByDisplayValue('Simple Syrup')
    await user.click(screen.getByRole('button', { name: /sub-recipe/i }))
    expect(screen.queryByDisplayValue('Coupe')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Lime wheel')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('rum')).not.toBeInTheDocument()
  })

  it('toggles tags', async () => {
    cloudParse.mockResolvedValue([draft('Daiquiri')])
    const user = await paste()

    await screen.findByDisplayValue('Daiquiri')
    const classic = screen.getByRole('button', { name: /classic/i })
    await user.click(classic)
    await user.click(screen.getByRole('button', { name: /^🍋 sour$/i }))

    await user.click(screen.getByRole('button', { name: /^import$/i }))
    await waitFor(async () =>
      expect((await db.recipes.toArray())[0]?.tags).toEqual(['classic']),
    )
  })
})

describe('duplicate flagging', () => {
  const withLibrary = async () => {
    await db.recipes.put({
      id: 'existing-daiquiri',
      kind: 'cocktail',
      name: 'Daiquiri',
      ingredients: [],
      measureBasis: 'absolute',
      baseServings: 1,
      tags: [],
      notes: [],
      createdAt: 0,
      updatedAt: 0,
    })
  }

  it('flags a drink you already own and unticks it so Import cannot duplicate it', async () => {
    await withLibrary()
    cloudParse.mockResolvedValue([draft('Rum Sour', { aka: ['Daiquiri'] }), draft('Negroni')])
    cloudJudgeDuplicates.mockResolvedValue([
      { index: 0, relation: 'same', match: 'Daiquiri', reason: 'same drink, other name' },
    ])
    const user = await paste()

    expect(await screen.findByText(/already saved/i)).toBeInTheDocument()
    // both were selected on arrival; the duplicate verdict drops it back to one
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^import$/i })).toBeInTheDocument(),
    )

    await user.click(screen.getByRole('button', { name: /^import$/i }))
    await waitFor(async () => {
      const names = (await db.recipes.toArray()).map((r) => r.name).sort()
      expect(names).toEqual(['Daiquiri', 'Negroni'])
    })
  })

  it('labels a variation but still imports it — a riff is its own drink', async () => {
    await withLibrary()
    cloudParse.mockResolvedValue([draft('Hemingway Daiquiri')])
    cloudJudgeDuplicates.mockResolvedValue([
      { index: 0, relation: 'variation', match: 'Daiquiri', reason: 'adds grapefruit' },
    ])
    const user = await paste()

    expect(await screen.findByText(/variation of/i)).toBeInTheDocument()
    expect(screen.getByText(/adds grapefruit/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^import$/i }))
    await waitFor(async () => {
      const names = (await db.recipes.toArray()).map((r) => r.name).sort()
      expect(names).toEqual(['Daiquiri', 'Hemingway Daiquiri'])
    })
  })

  it('never asks the cloud when nothing in the library looks close', async () => {
    await withLibrary()
    cloudParse.mockResolvedValue([draft('Negroni')])
    await paste()

    await screen.findByDisplayValue('Negroni')
    expect(cloudJudgeDuplicates).not.toHaveBeenCalled()
  })

  it('sends only matched names to the cloud, never the library or the recipes', async () => {
    await withLibrary()
    cloudParse.mockResolvedValue([draft('Rum Sour', { aka: ['Daiquiri'] })])
    await paste()

    await screen.findByDisplayValue('Rum Sour')
    await waitFor(() => expect(cloudJudgeDuplicates).toHaveBeenCalled())
    expect(cloudJudgeDuplicates.mock.calls[0][0]).toEqual([
      { index: 0, name: 'Rum Sour', aka: ['Daiquiri'], candidates: ['Daiquiri'] },
    ])
  })

  it('still renders the preview when the duplicate check fails', async () => {
    await withLibrary()
    cloudParse.mockResolvedValue([draft('Rum Sour', { aka: ['Daiquiri'] })])
    cloudJudgeDuplicates.mockRejectedValue(new Error('offline'))
    await paste()

    expect(await screen.findByDisplayValue('Rum Sour')).toBeInTheDocument()
    expect(screen.queryByText(/already saved/i)).not.toBeInTheDocument()
  })
})

describe('extraction failures', () => {
  it('surfaces the error and keeps the pasted text', async () => {
    cloudParse.mockRejectedValue(new Error('No recipes found in that text.'))
    await paste('junk')

    expect(await screen.findByText(/no recipes found/i)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('junk')
  })
})
