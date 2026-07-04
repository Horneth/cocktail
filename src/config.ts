// Feature flags. Kill switches that let a feature be disabled app-wide by
// flipping one boolean (no other code changes needed), then redeploying.
export const FEATURES = {
  /**
   * Optional cloud parsing via a user-supplied Gemini API key (stored only in
   * the browser). Set to `false` to remove every AI entry point — the Settings
   * gear, the AI section, and the "Smart parse" button — leaving the app
   * exactly as it was before the integration. Fully client-side; no repo secret.
   */
  cloudAI: true,
} as const
