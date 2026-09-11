// The one style contract for pool image generation.
//
// Generation-side only — the app never imports this. The seeder script
// (scripts/generate-images.mjs) and the Cloud Function both import this file
// verbatim, which is what keeps every pool image looking like one photographer
// shot it, and what keeps the prompt entirely server-side: a client asks for a
// drink by name and receives a key, never a prompt.
//
// Prompt-injection rule: the recipe name arrives through `sanitizeDrinkName`
// (see poolKey.mjs) and is embedded as a quoted DATA line; everything the
// model renders is decided by the fixed STYLE below.

import { MAX_INGREDIENTS, sanitizeDrinkName } from './poolKey.mjs'

export const IMAGE_MODEL = 'gemini-3.1-flash-image'

const STYLE = `Editorial cocktail photography, centered close shot, shallow depth of field,
warm blurred bar-back bokeh, soft rim light, the drink prominent in its glass on a
clean warm tabletop. One glass only. No text, no labels, no hands, no logos, no
props, no brand names, no people. Vertical 3:4 composition.`

/**
 * Everything the generator is allowed to know about the drink.
 * @typedef {object} DrinkSpec
 * @property {string} name - already `sanitizeDrinkName`-ed by the caller
 * @property {string} [glass] - glass name like "coupe", "rocks glass", "highball"
 * @property {string} [garnish]
 * @property {string} [spirit]
 * @property {string[]} [ingredients] - key ingredient names; the drink's COLOUR
 *   comes from what's in the glass (Campari = red), so these are the strongest
 *   appearance signal the model gets. Sanitized + capped by the caller.
 */

/**
 * The prompt for one pool entry. `spec.name` MUST already be
 * `sanitizeDrinkName`-ed (this function re-sanitizes defensively, but callers
 * sanitize first so their own validation is what enforces it).
 *
 * @param {DrinkSpec} spec
 * @returns {string}
 */
export function buildImagePrompt(spec) {
  const name = sanitizeDrinkName(spec.name)
  const glass = sanitizeDrinkName(spec.glass ?? '')
  const garnish = sanitizeDrinkName(spec.garnish ?? '')
  const spirit = sanitizeDrinkName(spec.spirit ?? '')
  const ingredients = (spec.ingredients ?? [])
    .map(sanitizeDrinkName)
    .filter(Boolean)
    .slice(0, MAX_INGREDIENTS)
  const look = [
    `The drink is called "${name}".`,
    glass && `Serve it in a ${glass}.`,
    spirit && `Base spirit: ${spirit}.`,
    ingredients.length && `Ingredients: ${ingredients.join(', ')}.`,
    garnish && `Garnish: ${garnish}.`,
    'Match the drink as it is actually made: its colour, opacity, ice and garnish must' +
      ' follow from those ingredients.',
  ]
    .filter(Boolean)
    .join(' ')

  return `${STYLE}

${look}
If you do not recognise the drink, render a plausible cocktail for the given
glass and base spirit instead of inventing text or objects.`
}
