// Types for poolPrompt.mjs (generation-side shared module — seeder script and
// Cloud Function import the .mjs directly).

export declare const IMAGE_MODEL: string

export interface DrinkSpec {
  /** already `sanitizeDrinkName`-ed by the caller */
  name: string
  /** glass name like "coupe", "rocks glass", "highball" */
  glass?: string
  garnish?: string
  spirit?: string
}

export declare function buildImagePrompt(spec: DrinkSpec): string
