import { describe, expect, it } from 'vitest'
import type { Recipe } from '../db/schema'
import { migrateLegacyRecipe } from './recipeKind'

const recipe = (over: Partial<Recipe>): Recipe =>
  ({
    id: 'r1',
    kind: 'cocktail',
    name: 'Test',
    ingredients: [],
    updatedAt: 0,
    ...over,
  }) as Recipe

// Legacy records arrive as plain JSON with values the current type no longer
// allows — the whole point of the migration. Cast at the edge, like db.ts does.
const legacy = (over: Record<string, unknown>): Recipe =>
  ({ id: 'r1', name: 'Test', ingredients: [], updatedAt: 0, ...over }) as unknown as Recipe

describe('migrateLegacyRecipe', () => {
  it('folds the old "component" kind into "syrup"', () => {
    const migrated = migrateLegacyRecipe(legacy({ kind: 'component' }))
    expect(migrated.kind).toBe('syrup')
  })

  it('folds the retired "cordial" kind into "syrup"', () => {
    expect(migrateLegacyRecipe(legacy({ kind: 'cordial' })).kind).toBe('syrup')
  })

  it('renames the subRecipeId cross-link field', () => {
    const input = legacy({
      kind: 'syrup',
      ingredients: [{ id: 'i1', name: 'Rum', amount: 2, unit: 'oz', subRecipeId: 'r9' }],
    })
    const migrated = migrateLegacyRecipe(input)
    expect(migrated.ingredients[0]).not.toHaveProperty('subRecipeId')
    expect(migrated.ingredients[0].recipeId).toBe('r9')
  })

  it('returns the input untouched when nothing needs rewriting', () => {
    const r = recipe({ kind: 'syrup' })
    expect(migrateLegacyRecipe(r)).toBe(r)
  })
})