# On-device AI on Android — options memo

_Status: research memo / recommendation. Written 2026-07; Phase 0 has since shipped, the rest
has not. Updated 2026-08 for the cloud transport's move to Firebase AI Logic, and again when
the offline heuristic parser was deleted — the "heuristic floor" this memo leans on twice below
no longer exists, so an on-device text backend would now be the only alternative to the cloud,
not a middle tier._

## Why this exists

Cocktail's AI features (import of a pasted description, and "Scan my
shelf" bottle recognition) currently run on **cloud Gemini**. This memo re-explores
whether those features can run **on-device** — no cloud round-trip — with a focus on
**Android**, since that's the primary install target for the PWA.

The two capabilities to reproduce, both of which already emit structured JSON that pure,
reusable mappers in **`src/import/aiShared.ts`** turn into the app's
`StructuredImport`/`IdentifiedBottle`:

- **Text parse** — recipe/description text → structured recipes (`firebaseParse`).
- **Vision scan** — shelf photos → bottle list (`firebaseIdentifyBottles`).

A key structural advantage: any on-device backend only has to produce the **same raw JSON
shapes**; all normalization, linking, dedupe, and category inference is already downstream
and reusable.

## The landscape (mid-2026)

| Option | On-device on Android? | Text + vision | Verdict |
|---|---|---|---|
| **Chrome Prompt API / Gemini Nano** | ❌ Desktop-only. On Android, "Gemini in Chrome" runs in the **cloud** (Gemini 3.1), not on-device. | n/a | **Off the table** for a PWA on Android. |
| **WebLLM** (`@mlc-ai/web-llm`, WebGPU) | ✅ Chrome for Android 121+ (WebGPU present on ~70–75% of Android devices) | Text (strong). No vision. | **Best text engine** — the only in-browser runtime with grammar / JSON-schema-**constrained decoding**, which matches our structured-output contract exactly. Model ~1–2 GB. |
| **transformers.js** (`@huggingface/transformers`) | ✅ WebGPU **+ WASM fallback** (degrades instead of hard-failing) | Vision via small VLMs (e.g. SmolVLM). | **Best vision starting point** — small models (~0.5–1 GB), works without WebGPU via WASM. No grammar mode, so needs tolerant JSON extraction. |
| **LiteRT-LM / MediaPipe** (Gemma 3n) | ✅ WebGPU | ✅ Multimodal (text + image) in one engine | Web-optimized model is **~3 GB and wants ~4 GB VRAM** → high-end phones only. A **quality-upgrade path** for vision, not the first slice. |
| **Native ML Kit GenAI / Gemini Nano (AICore)** | ✅ Best models; AICore manages the download | ✅ (Image Description, multimodal Prompt) | Requires a **native wrapper** (TWA/Capacitor) — breaks the pure-PWA model. **Flagship-only** devices (Pixel 9, Galaxy S25, Xiaomi 15…). Structured Output API still **"upcoming,"** not GA. |

**Through-line:** on-device AI on Android in 2026 is a **high-end-device-only** capability on
every path — because of WebGPU coverage, multi-GB model downloads, or flagship-only native
APIs. So it should ship as an **experimental opt-in alongside cloud AI**, never a replacement,
alongside cloud AI. (When this was written there was also an offline heuristic parser as a
guaranteed floor for text; it has since been deleted, so on-device would be the only non-cloud
text path rather than a third tier.)

## Recommendation

1. **Ship on-device as an optional in-browser (pure-PWA) backend**, behind a new
   `FEATURES.onDeviceAI` flag, using functions signature-compatible with the cloud ones so the
   UI barely changes. Keep cloud as the default. Fallback order: **on-device → cloud**.
2. **Engines:**
   - **Text → WebLLM.** Grammar-constrained JSON decoding is the decisive advantage; a small
     instruct model (Qwen2.5-1.5B/3B or Llama-3.2-1B/3B) can emit schema-valid `StructuredImport`.
   - **Vision → transformers.js SmolVLM.** Small, and the WASM fallback means vision degrades
     rather than hard-failing on the ~25–30% of Android devices without WebGPU.
3. **Native wrapper (ML Kit GenAI / Gemini Nano):** document as the *future* best-quality
   Android route, but **don't build it first** — flagship-only coverage, not-yet-GA structured
   output, and it abandons PWA distribution. Revisit once ML Kit's Structured Output API is GA
   and if pure-PWA quality proves insufficient.

## Phased POC (build next)

- **Phase 0 — Refactor, zero behavior change. ✅ Done.** `src/import/aiShared.ts` holds the
  transport-agnostic core (schemas, prompts, mappers, `finishParse`, a `toJsonSchema()`
  converter) and its tests. It has since survived a real transport swap — the BYO-key
  `gemini.ts` was replaced wholesale by `firebaseAI.ts` without touching the core — which is
  the evidence the seam is in the right place. An on-device backend plugs in the same way.
- **Phase 1 — Text via WebLLM**, flag-off by default: `src/import/onDeviceAI.ts` with
  `onDeviceParse()`, a `webgpuAvailable()` gate, a Cloud/On-device selector + download-progress
  in `ImportScreen`, and fall-through to the cloud transport. Reliability: grammar constraint →
  `JSON.parse` try/catch → one retry at temp 0 → fall back.
- **Phase 2 — Vision via transformers.js SmolVLM** in `BarScreen`, reusing
  `downscaleDataUrl`/`splitDataUrl`/`dedupeBottles`, with WASM fallback.
- **Phase 3+ (not POC)** — upgrade vision to Gemma 3n via `@mediapipe/tasks-genai` if SmolVLM
  is too weak.

Guardrails: new deps are **lazy-loaded** (`await import(...)`) so the core bundle is untouched
until opt-in; exclude the AI chunks from the Workbox precache; leave multi-GB model weights to
each engine's own Cache Storage/IndexedDB, with a "Remove downloaded model" affordance.

## Risks

- **WebGPU coverage ~70–75% on Android** — text (WebLLM) hard-requires it; ~1-in-4 target
  devices fall back to cloud/heuristic. A native wrapper does **not** fix WebGPU availability.
- **Model download size** — ~1–2 GB (text), ~0.5–1 GB (vision) on mobile data. Must be
  Wi-Fi-gated and clearly messaged.
- **Small-model (1–3B) JSON quality** — grammar constrains *shape*, not *correctness*; expect
  meaningfully weaker extraction than Gemini 2.5 Flash. The heuristic/cloud fallback and the
  editable import preview are load-bearing.
- **Battery / thermal** — multi-second GPU inference on a phone is hot and slow; keep it
  opt-in, single-shot, and never the default.

## Sources

- Chrome Prompt API (desktop-only): https://developer.chrome.com/docs/ai/prompt-api
- WebLLM: https://github.com/mlc-ai/web-llm — docs: https://webllm.mlc.ai/
- transformers.js v3 (WebGPU): https://huggingface.co/blog/transformersjs-v3 — SmolVLM in-browser: https://pyimagesearch.com/2025/10/20/running-smolvlm-locally-in-your-browser-with-transformers-js/
- MediaPipe LLM Inference for Web: https://ai.google.dev/edge/mediapipe/solutions/genai/llm_inference/web_js
- LiteRT-LM: https://github.com/google-ai-edge/LiteRT-LM — Gemma 3n web model (~3 GB): https://huggingface.co/google/gemma-3n-E2B-it-litert-lm
- ML Kit GenAI APIs (Gemini Nano / AICore, flagship-only): https://developers.google.com/ml-kit/genai — https://developer.android.com/ai/gemini-nano
