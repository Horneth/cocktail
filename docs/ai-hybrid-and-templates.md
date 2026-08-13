# Server prompt templates & on-device inference — decision

_Status: **hardening shipped, templates proposed, on-device rejected**. Written 2026-08.
Extends `docs/cloud-ai-backend.md`, which covers the Firebase AI Logic setup this builds on._

Two Firebase AI Logic features arrived that touch how we call Gemini: **server prompt
templates** and **hybrid/on-device inference**. This records what we do with each, and
what we did instead while deciding.

## What we're actually protecting

Not the prompts. `VITE_FIREBASE_*` is public client config by design, so anyone can lift
it out of the bundle; the thing worth guarding is **our Gemini quota**, and today the only
guards are App Check and the sign-in gate. That framing decides everything below.

Prompt injection is a real but small problem here: there are no tools, no function calling
and no server, every call is pinned to a `responseSchema` so an injection can only change
field *values*, and `finishDupeJudgement` / `parseReconcile` / `dedupeBottles` already
discard anything the model didn't have permission to invent. Nothing reaches IndexedDB
without a user tick.

## Server prompt templates — worth doing

Prompts move into the Firebase project; the client sends a template ID plus variables.
Two wins: the prompt becomes editable without a redeploy, and **template-only mode**
reduces the endpoint to "runs our cocktail templates and nothing else", which is the
quota fix.

| Call | Template ID |
|---|---|
| `firebaseParse` | `cocktail-parse-v1-0-0` |
| `firebaseJudgeDuplicates` | `cocktail-dupes-v1-0-0` |
| `firebaseIdentifyBottles` | `cocktail-vision-v1-0-0` |
| `firebaseReconcileBottles` | `cocktail-reconcile-v1-0-0` |

**Verify before committing to it:** whether four downscaled base64 JPEGs (~1 MB) survive
as `{{media type= data=}}` template variables. Template-only mode is project-wide, so if
the vision call can't be templated it can't be turned on at all, and this shrinks to the
three text calls.

Shape: `getGeminiModel()` in `src/auth/firebase.ts` gains a `getTemplateModel()` sibling
around `getTemplateGenerativeModel(ai)` — already present in the pinned `firebase@12.17.1`,
no upgrade needed. The four functions in `src/import/firebaseAI.ts` keep their signatures
and their throw / never-throw contracts; only the call inside changes. Prompts stay in
`aiShared.ts` as the record of what was published.

Costs, so nobody is surprised: it's a **Preview** feature (no SLA, breaking changes
allowed); prompt iteration moves out of git into a console, which is a real loss in a repo
that unit-tests its prompts and now has to keep two copies in step; enum-constrained output
isn't supported, which costs us nothing since our schemas use plain strings.

## On-device inference — rejected, and not close

Chrome's Prompt API needs **22 GB free disk** plus either >4 GB VRAM or 16 GB RAM, and is
*"not yet supported"* on Chrome for Android, iOS, or non-Chromebook-Plus ChromeOS. That
hardware bar is why, and it isn't a rollout schedule a phone grows into. Chrome 140's
expansion added desktop **CPU** inference and said nothing about mobile. On iOS the
question doesn't arise: Apple's Foundation Models is native Swift with no WebKit surface,
and every iOS browser is WebKit.

Wrapping the PWA natively doesn't rescue it either. A TWA renders in Chrome and has no
JS↔native bridge, so it inherits exactly the capabilities above. Capacitor could reach the
Kotlin/Swift SDKs via a plugin we'd write — but **Android on-device has no structured
output**, and all four of our calls are structured-output calls. (iOS on-device is
text-only, ~4096 tokens, Apple-Intelligence devices only, foreground only.) Two native
toolchains and a store release process to buy nothing.

Revisit if Chrome ships the Prompt API on Android. If we want on-device *AI* on a phone
before then, the only route that reaches real users is in-browser embeddings
(`all-MiniLM-L6-v2` int8 is ~23 MB, with a WASM fallback where WebGPU is missing) to
strengthen the **local shortlist** in `domain/dupeMatch.ts` and `domain/bottleMatch.ts` —
fewer cloud calls, not a replacement for the cloud judgement, since "Rum Sour is a
Daiquiri" needs world knowledge a 22M-parameter encoder doesn't have. Unexplored.

Note the design that *would* have worked, if this is picked up again: `ONLY_ON_DEVICE`
never makes a cloud request (it throws when the Prompt API is absent), so it stays
compatible with project-wide template-only mode — the incompatibility the docs list is
really between templates and hybrid's *cloud fallback leg*. The two calls it fits are
`firebaseJudgeDuplicates` and `firebaseReconcileBottles`, the two this repo already
documents as *must not throw*; "no on-device model" is the failure mode they were built to
absorb. Also undocumented and worth knowing: `systemInstruction` is silently dropped on the
on-device path — the equivalent is a `{ role: 'system' }` entry in
`onDeviceParams.createOptions.initialPrompts`.

## What shipped instead

Independent of the above, and worth having either way:

- **`cleanModelText()` + `TEXT_CAPS`** in `aiShared.ts`, applied at the four validation
  chokepoints that already existed. Strips control characters, collapses whitespace, caps
  length. Unknown tags are still allowed through — they're tolerated by design.
- **`buildReconcilePrompt` sends JSON**, like its twin `firebaseJudgeDuplicates` always
  did. `detected` is pass-1 output, i.e. whatever was printed on a photographed label, and
  hand-quoting it into prose let a label close the quote and address the model about the
  other entries in the batch.
- **The share target requires a click** for anything that isn't a YouTube link under a size
  cap. Any app can share into us, and an unattended extract meant arbitrary text reaching
  the model on someone else's say-so. This is the companion to `import/limits.ts`: that
  bounds what one call may cost, this bounds who may make one.
- **`isCloudAIConfigured()` now requires `recaptchaSiteKey`.** `ensureFirebase()` skips App
  Check entirely when it's empty, so a lost build variable would have quietly removed our
  main defence. Better to ship no AI than unprotected AI.

## Console setup, when templates are done

The project is `cocktails-c2705`, same as Hosting. Steps 1–6 in `docs/cloud-ai-backend.md`
still apply; these are additional.

1. **AI Logic → Prompt templates →** author the four templates above. Frontmatter carries
   `model`, `config.temperature` (0 / 0.1 / 0.2 — currently per-call in `firebaseAI.ts`),
   and `output.format: json` with the schema translated from `RESPONSE_SCHEMA` and friends.
   `{{role "system"}}` holds the instructions, which also fixes the current
   instructions-and-untrusted-text-in-one-turn shape for free.
2. Test the vision template with real photo data **before** step 4.
3. **Lock** each template. (Locking guards against accidental edits; it does not fully
   prevent them.)
4. Enable **template-only mode** for the project.
5. Confirm a non-template request is now rejected, and that import + shelf scan still work.

## Sources

- Hybrid inference, web: https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
- Hybrid, Android / iOS: https://firebase.google.com/docs/ai-logic/hybrid/android/get-started ·
  https://firebase.google.com/docs/ai-logic/hybrid/ios/get-started
- Server prompt templates: https://firebase.google.com/docs/ai-logic/server-prompt-templates/get-started
- Template syntax: https://firebase.google.com/docs/ai-logic/server-prompt-templates/syntax-and-examples
- Not-yet-supported + security: https://firebase.google.com/docs/ai-logic/server-prompt-templates/best-practices-and-considerations
- Chrome Prompt API support & hardware: https://developer.chrome.com/docs/ai/prompt-api
- Chrome 140 CPU inference: https://developer.chrome.com/blog/gemini-nano-cpu-support
- The two undocumented SDK behaviours above are checkable in
  `node_modules/@firebase/ai/dist/esm/index.esm.js` — `ChromeAdapterImpl.isAvailable` (~1155)
  and `createSession` (~1343).
