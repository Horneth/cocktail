# Server prompt templates — source of truth

The four prompts, in Dotprompt form, ready to paste into **Firebase console → AI Logic →
Prompt templates**. Phase 1 of `docs/ai-hybrid-and-templates.md`.

These files are the authored copy; the console holds the deployed copy. Keeping them here
is deliberate — the main cost of templating is that prompts leave git, and this is how we
refuse to pay all of it. **Edit here first, then paste.** A console edit that doesn't come
back to this directory is how the two drift.

| File | Template ID | Replaces |
|---|---|---|
| `cocktail-parse-v1-0-0.prompt` | `cocktail-parse-v1-0-0` | `PROMPT` + `RESPONSE_SCHEMA` |
| `cocktail-dupes-v1-0-0.prompt` | `cocktail-dupes-v1-0-0` | `DUPE_PROMPT` + `DUPE_SCHEMA` |
| `cocktail-vision-v1-0-0.prompt` | `cocktail-vision-v1-0-0` | `VISION_PROMPT` + `BOTTLES_SCHEMA` |
| `cocktail-reconcile-v1-0-0.prompt` | `cocktail-reconcile-v1-0-0` | `RECONCILE_PROMPT` + `RECONCILE_SCHEMA` |

`model`, `temperature` and `maxOutputTokens` come from `src/config.ts`, `firebaseAI.ts` and
`import/limits.ts` respectively — they move into frontmatter, so **the client stops choosing
them**. `limits.ts` keeps `MAX_PARSE_CHARS`, `MAX_SCAN_IMAGES` and `MAX_IMAGE_BYTES`, which
are input bounds the transport still enforces before it calls out.

## Three things to know before pasting

**The vocabularies are inputs, not baked in.** `{{methods}}`, `{{glasses}}` and `{{tagVocab}}`
are passed per call from `domain/vocab.ts`. Baking the lists into the console would re-fork
the one vocabulary the prompt, the editor and the import picker share — the exact thing
CLAUDE.md says not to do. The cost is three short strings per parse call.

**The line-oriented rendering is safe because of `cleanModelText`.** The dupes and reconcile
templates render each entry as indented `key: value` lines. That is only injection-resistant
because no value can contain a newline: `cleanModelText()` strips them at the four validation
chokepoints in `aiShared.ts`, before anything reaches a prompt. If that guarantee is ever
relaxed, these two templates have to change with it.

**Untrusted input is named as untrusted.** Each template's system turn says which of its
inputs came from a user's paste or a photographed label. That is not a security boundary —
the schema and the validators in `aiShared.ts` are — but it is free, and it is the part
`{{role "system"}}` buys us that the current single-turn concatenation cannot.

## Order of work

1. **Create `cocktail-vision-v1-0-0` first and test it with a real photo.** Four downscaled
   JPEGs is ~1 MB of `{{media}}` input variables and may not survive. Everything below
   depends on the answer: template-only mode is project-wide, so if vision can't be
   templated, it can't be enabled at all and Phase 1 shrinks to the three text calls.
2. Create the other three. Use the **Test** panel in the console with the sample inputs
   below before wiring any client code.
3. Wire the client: `getTemplateModel()` in `src/auth/firebase.ts` wrapping
   `getTemplateGenerativeModel(ai)`, and swap the call inside each of the four functions in
   `src/import/firebaseAI.ts`. Signatures and the throw / never-throw contracts stay as they
   are — `firebaseJudgeDuplicates` and `firebaseReconcileBottles` must still resolve to `[]`
   rather than throw.
4. Run `npm test` — `firebaseAI.test.ts` mocks the model handle, so it will need the mock
   updated to the template call shape. That is the test that proves the payloads didn't change.
5. **Lock** each template in the console.
6. Enable **template-only mode** for the project, and confirm a non-template request is
   rejected while import and shelf scan still work.

Templates take a couple of minutes to propagate. Bump the version suffix (`-v1-0-1`) rather
than editing a locked template in place; the ID lives in the client, so a rename is a code
change unless it is behind Remote Config.

## Sample inputs for the console Test panel

`cocktail-parse-v1-0-0`:

```json
{
  "description": "Daiquiri\n2 oz white rum\n0.75 oz lime juice\n0.75 oz simple syrup\nShake, double strain, coupe.",
  "methods": "Shake, Stir, Build, Blend, Throw, Swizzle",
  "glasses": "Coupe, Rocks, Highball, Collins, Nick & Nora, Martini, Flute, Wine, Tiki mug, Julep tin, Mug, Shot",
  "tagVocab": "classic, sour, citrusy, refreshing, spirit-forward, bitter, bubbly, herbal, sweet, nightcap, low-abv, tropical, smoky, creamy, fruity, brunch, spicy, frozen, tiki, syrup"
}
```

Expect one recipe, `spirit: "rum"`, and `guessed` containing `garnish` and `tags` but not
`method` or `glassware` (both are stated in the text).

`cocktail-dupes-v1-0-0`:

```json
{
  "entries": [
    { "index": 0, "name": "Rum Sour", "aka": ["Daiquiri"], "candidates": ["Daiquiri"] },
    { "index": 1, "name": "Hemingway Daiquiri", "aka": ["Daiquiri"], "candidates": ["Daiquiri"] }
  ]
}
```

Expect `same` for index 0 and `variation` for index 1. Getting index 1 wrong is the failure
that matters — it would untick a drink the user does not own.

`cocktail-reconcile-v1-0-0`:

```json
{
  "detections": [
    { "detected": "Plantation 3 Stars", "category": "rum", "candidates": ["Plantation Three Stars White Rum"] },
    { "detected": "Tanqueray No. Ten", "category": "gin", "candidates": ["Tanqueray"] }
  ]
}
```

Expect `same` then `variant`. Both verdicts flipping the other way is the known failure mode
this call exists to prevent.

`cocktail-vision-v1-0-0` needs a real photo: `{"photos": [{"mimeType": "image/jpeg", "data": "<base64>"}]}`.
