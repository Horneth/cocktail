// Feature flags. Kill switches that let a feature be disabled app-wide by
// flipping one boolean (no other code changes needed), then redeploying.
export const FEATURES = {
  /**
   * Cloud AI parsing (Smart parse + Shelf scan) via Firebase AI Logic. Google
   * runs the proxy and the Gemini key lives in the Firebase project — never in
   * this app. Gated behind an optional Google sign-in (see `useAuth`). Set to
   * `false` to remove every AI entry point, leaving the app fully offline-only.
   */
  cloudAI: true,
} as const

// ── Firebase (public client config, NOT secrets) ────────────────────────────
// These identify the Firebase project from the browser; they're safe to ship.
// The actual Gemini API key stays server-side in the Firebase project and is
// never exposed here. Provide them at build time via Vite env vars (e.g. a
// `.env` file or CI secrets) so nothing project-specific is hard-coded:
//
//   VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
//   VITE_FIREBASE_APP_ID, VITE_FIREBASE_STORAGE_BUCKET,
//   VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_RECAPTCHA_SITE_KEY
//
// See docs/cloud-ai-backend.md for the one-time Firebase console setup.
const env = import.meta.env

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
  appId: env.VITE_FIREBASE_APP_ID ?? '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
}

/** reCAPTCHA v3 site key for Firebase App Check (required to call AI Logic). */
export const recaptchaSiteKey = env.VITE_RECAPTCHA_SITE_KEY ?? ''

/** The Gemini model used for cloud calls. */
export const CLOUD_AI_MODEL = 'gemini-2.5-flash'

/**
 * True only when the Firebase project is wired up. Until then the AI features
 * stay hidden/disabled and the app runs as a pure offline recipe book.
 */
export function isCloudAIConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId)
}
