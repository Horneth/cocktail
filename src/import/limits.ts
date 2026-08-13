// Ceilings on what one AI request may cost. Every input below is pasted or
// photographed by the user, so without these a single request bills for an
// arbitrary number of tokens.
//
// Their own module, rather than constants in `aiShared.ts`, for two reasons.
// `image.ts` needs the byte budget and is imported eagerly by the Bar tab —
// reaching into `aiShared` for it would pull 28 KB of prompts into a chunk that
// loads for everyone who opens My Bar, including the majority who never scan.
// And a server-side proxy has to enforce the same numbers: a limit only the
// client knows is a limit the client can remove.

/** Longest pasted text a parse will accept. A YouTube description tops out at 5k. */
export const MAX_PARSE_CHARS = 20_000

/** Most photos one shelf scan may send. */
export const MAX_SCAN_IMAGES = 4

/** Largest decoded payload accepted per photo. */
export const MAX_IMAGE_BYTES = 500_000

/**
 * Output ceiling per call. Generous enough that real work never truncates — a
 * long description yields a handful of recipes, a crowded shelf a few dozen
 * bottles — but finite, which is the whole point.
 */
export const MAX_OUTPUT_TOKENS = {
  parse: 8192,
  dupes: 1024,
  bottles: 4096,
  reconcile: 2048,
} as const
