// Infer a spirit "category" from a free-text bottle or ingredient name. The
// returned keys line up with the tile taxonomy in `spirits.ts` (SPIRIT_ORDER),
// so the Bar screen can reuse `tileMeta`/`spiritSortIndex` to render section
// headers, and availability matching (Phase 5) can treat a generic bottle as
// covering a specific call ("Jamaican rum" satisfied by any rum).
//
// Pure and framework-free — no React, no Dexie. Tested in spiritCategory.test.ts.

// Ordered: first match wins. Zero-proof is checked first so "non-alcoholic gin"
// reads as a mocktail, not gin; specific spirits before broad families; brand
// names (which carry no family word, e.g. "Woodford Reserve") folded into each
// family so a bare bottle name still resolves.
const HINTS: [RegExp, string][] = [
  // zero-proof / no-AB01
  [/\b(non-?alcoholic|zero-?proof|virgin|mocktail|seedlip|lyre'?s|ritual zero|athletic brewing)\b/i, 'mocktail'],

  // specific agave / cane spirits (before the broader families)
  [/\bcacha[çc]a\b/i, 'cachaça'],
  [/\bmezcal\b/i, 'mezcal'],
  [/\bpisco\b/i, 'pisco'],

  // gin (+ common brands)
  [/\b(gin|tanqueray|beefeater|bombay|hendrick'?s|plymouth|sipsmith|the botanist|aviation|monkey 47|ford'?s|roku)\b/i, 'gin'],

  // whiskey family (+ bourbon/rye/scotch and common brands)
  [/\b(whiskey|whisky|bourbon|rye|scotch|woodford|maker'?s mark|buffalo trace|knob creek|jim beam|jack daniel'?s?|wild turkey|bulleit|four roses|elijah craig|michter'?s|rittenhouse|sazerac|high west|jameson|redbreast|monkey shoulder|johnnie walker|glenlivet|glenfiddich|macallan|lagavulin|laphroaig)\b/i, 'whiskey'],

  // tequila (+ brands)
  [/\b(tequila|patr[óo]n|don julio|espol[óo]n|herradura|casamigos|olmeca|fortaleza|el tesoro|tapat[íi]o)\b/i, 'tequila'],

  // rum / rhum / cane (+ brands)
  [/\b(rum|rhum|bacardi|appleton|mount gay|plantation|diplomatico|el dorado|goslings?|myers'?s?|flor de ca[ñn]a|havana club|smith ?&? ?cross|wray ?&? ?nephew|pusser'?s)\b/i, 'rum'],

  // vodka (+ brands)
  [/\b(vodka|tito'?s|grey goose|absolut|ketel one|smirnoff|belvedere|stolichnaya|stoli)\b/i, 'vodka'],

  // cognac / grape brandy families (cognac before generic brandy)
  [/\b(cognac|armagnac|hennessy|r[ée]my martin|courvoisier|martell|pierre ferrand)\b/i, 'cognac'],
  [/\b(brandy|calvados|applejack|laird'?s|pisco)\b/i, 'brandy'],

  // agave umbrella (raicilla, sotol, generic "agave spirit")
  [/\b(agave|raicilla|sotol)\b/i, 'agave'],

  // aromatized / fortified wines
  [/\b(wine|vermouth|sherry|port|prosecco|champagne|lillet|cocchi|dubonnet|madeira|marsala|sake)\b/i, 'wine'],

  // mixers & syrups — a stocked syrup is its own thing on the shelf, not
  // "Other" (checked before the broad liqueur net, which used to swallow
  // "Lime Cordial"). Never matchable: a syrup bottle satisfies a call by its
  // own name, never by family.
  [/\b(syrup|grenadine|orgeat|gomme|cordial)\b/i, 'syrup'],

  // liqueurs & amari (broad keyword net, checked last)
  [/\b(liqueur|amaro|amaretto|cointreau|grand marnier|cur[aç]ao|triple sec|chartreuse|st[.\- ]?germain|b[ée]n[ée]dictine|drambuie|midori|kahl[úu]a|baileys|frangelico|disaronno|chambord|galliano|fernet|averna|cynar|montenegro|campari|aperol|maraschino|falernum|ancho reyes|suze|aperitivo)\b/i, 'liqueur'],
]

/**
 * The category ('rum','whiskey','gin',…) for a bottle/ingredient name, or
 * undefined when the name isn't a recognizable spirit/liqueur (e.g. "Lime
 * juice", "Egg white"). Mixers resolve to 'syrup' so a stocked syrup groups
 * with its kind on the Bar screen; 'syrup' is deliberately NOT in
 * MATCHABLE_CATEGORIES.
 */
export function categoryForName(name: string): string | undefined {
  const n = name.toLowerCase()
  for (const [re, cat] of HINTS) {
    if (re.test(n)) return cat
  }
  return undefined
}

/**
 * Categories where a generic bottle genuinely substitutes for a specific call
 * (owning any "rum" covers "Jamaican rum"). Deliberately EXCLUDES liqueur/wine/
 * mocktail — a Campari must not satisfy a call for Chartreuse — and 'syrup':
 * a syrup bottle satisfies a call by its own name, never a family.
 * Used by availability matching; Bar grouping uses every category.
 */
export const MATCHABLE_CATEGORIES: ReadonlySet<string> = new Set([
  'rum', 'whiskey', 'gin', 'vodka', 'tequila', 'mezcal', 'brandy', 'cognac', 'cachaça', 'pisco', 'agave',
])
