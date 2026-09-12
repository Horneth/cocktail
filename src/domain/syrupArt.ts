import type { BottleShape } from './spiritVisual'
import { normalizeMixerName } from './textNormalize'

// Syrup art is DRAWN, not generated: a generic bottle silhouette (the same
// vocabulary the Bar screen's bottle glyphs use) filled with the liquid colour
// that syrup actually has. Photo models turn "syrup" into a served drink no
// matter what the prompt says; a colour table is deterministic, instant,
// offline, and free — and the name is the strongest colour signal there is
// (grenadine is red because pomegranate is).
//
// Pure and framework-free — tested in syrupArt.test.ts.

export interface SyrupArt {
  /** the liquid colour; may carry an alpha for the translucent ones */
  fill: string
  /** which generic bottle silhouette to draw */
  shape: BottleShape
}

// First match wins, so more specific names go first ("blue curaçao" before
// "curaçao"). Keys are fragments matched against the NORMALIZED mixer name, so
// "Rich Simple Syrup (2:1)" hits the same entry as "Simple Syrup".
const FILLS: [RegExp, string][] = [
  [/\bgrenadine\b/, '#b02a33'],
  [/\borgeat\b/, '#e9dcc4'],
  [/\bcream of coconut\b|\bcoconut\b|\bcream of\b/, '#f3ecdc'],
  [/\bblue cura/, '#2f7fc0'],
  [/\bcura|\btriple sec\b/, '#d97a2b'],
  [/\bdemerara\b|\braw sugar\b|\bmuscovado\b|\bpanela\b|\bpiloncillo\b/, '#b5722e'],
  [/\bgomme\b|\bgum syrup\b|\brock candy\b|\bcane\b|\bsugar syrup\b/, 'hsl(46 60% 72% / .55)'],
  [/\bsimple\b|\bbar sugar\b/, 'hsl(46 60% 72% / .55)'],
  [/\bmaple\b/, '#8c4a1f'],
  [/\bhoney\b/, '#d9a441'],
  [/\bagave\b/, '#e0c76a'],
  [/\brasberry\b|\bframboise\b|\bmalina\b/, '#b32547'],
  [/\bstrawberry\b|\bfraise\b/, '#c74a35'],
  [/\bblackberry\b|\bberry\b|\bmure\b|\bblackcurrant\b|\bcassis\b/, '#5f2a4d'],
  [/\bcranberry\b/, '#a42636'],
  [/\bcherry\b|\bmaraschino cherry\b/, '#8e2231'],
  [/\bpassion ?fruit\b|\bmaracuja\b/, '#e0912f'],
  [/\bmango\b/, '#e0872f'],
  [/\bapricot\b/, '#d97f3c'],
  [/\bpeach\b/, '#e08d6b'],
  [/\bbanana\b/, '#e5cf6a'],
  [/\bvanilla\b/, '#ecdcb0'],
  [/\bfalernum\b/, '#e5c98e'],
  [/\bginger\b|\bginger syrup\b/, '#e0c377'],
  [/\bcinnamon\b|\bspice\b|\bchai\b|\bpumpkin\b/, '#a9682f'],
  [/\bcoffee\b|\bespresso\b/, '#5a3a28'],
  [/\bchocolate\b|\bcocoa\b|\bmocha\b/, '#5f3a28'],
  [/\btamarind\b/, '#7a4a28'],
  [/\bmint\b|\bjulep\b|\bmenthe\b/, '#a8c69f'],
  [/\bcurrant\b|\bgooseberry\b/, '#b7c94e'],
  [/\blime\b|\bcitrus\b|\bcelery\b/, '#b7c94e'],
  [/\blemon\b|\byuzu\b|\bcalamansi\b/, '#e7dc8a'],
  [/\bgrapefruit\b|\bpamplemousse\b/, '#e8a06a'],
  [/\belderflower\b|\belder\b/, '#e8e2b2'],
  [/\blavender\b/, '#b8a6cf'],
  [/\bhibiscus\b|\bjamaica\b|\bsorrel\b/, '#a03254'],
  [/\bchia\b|\bherbal\b|\bchartreuse\b/, '#a9b56a'],
]

// Three generic bottle shapes, picked by the name's hash so the same syrup
// always draws the same bottle without a code change. The set reads as "a few
// generic small bottles"; the colour carries the identity.
const SHAPES: BottleShape[] = ['jar', 'tall', 'liqueur']

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** Deterministic warm syrup colour for a name the curated map doesn't know. */
function generatedFill(name: string): string {
  const h = hash(name) % 360
  return `hsl(${h} 48% 55% / .8)`
}

/**
 * The drawn-bottle art for a syrup: liquid colour + silhouette, both
 * deterministic from the name ("Rich Simple Syrup (2:1)" hits the same entry
 * as "Simple Syrup" via normalizeMixerName).
 */
export function syrupArt(name: string): SyrupArt {
  const key = normalizeMixerName(name)
  const fill = FILLS.find(([re]) => re.test(key))?.[1] ?? generatedFill(key || name)
  return { fill, shape: SHAPES[hash(key || name) % SHAPES.length] }
}