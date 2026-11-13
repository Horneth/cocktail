// Feature flags. Kill switches that let a feature be disabled app-wide by
// flipping one boolean (no other code changes needed), then redeploying.
export const FEATURES = {
  /**
   * Cloud AI (recipe import + shelf scan) via Firebase AI Logic. Google
   * runs the proxy and the Gemini key lives in the Firebase project — never in
   * this app. Gated behind an optional Google sign-in (see `useAuth`). Set to
   * `false` to remove every AI entry point, leaving the app fully offline-only —
   * note that this also removes recipe import, which is AI-only. Adding a recipe
   * by hand (`/new`) is then the only way in.
   */
  cloudAI: true,
} as const;

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
const env = import.meta.env;

/**
 * Where the Auth helper (`/__/auth/handler`, `/__/auth/iframe`) is served from.
 *
 * This is the crux of the mobile sign-in fix. `signInWithRedirect` completes by
 * sending the browser back to the app, where the SDK reads the *authDomain's*
 * storage to recover the credential. When the authDomain is a different site
 * from the app, browsers now block that read (third-party storage
 * partitioning), so the redirect silently finishes with no user —
 * `getRedirectResult()` returns null and nothing is logged
 * (firebase/firebase-js-sdk#7824).
 *
 * The default `*.firebaseapp.com` is a different site from our `*.web.app`
 * hosting domain, so we name the origin we are actually served from: Firebase
 * Hosting serves the helper on its own domains, making the whole flow
 * same-origin. Non-Hosting origins (localhost, tests) keep the configured value.
 */
function resolveAuthDomain(configured: string): string {
  if (typeof location === "undefined") return configured;
  const host = location.hostname;
  if (location.protocol === "https:" && /\.(web\.app|firebaseapp\.com)$/.test(host)) {
    return host;
  }
  return configured;
}

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: resolveAuthDomain(env.VITE_FIREBASE_AUTH_DOMAIN ?? ""),
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
  appId: env.VITE_FIREBASE_APP_ID ?? "",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? "",
  // Optional, and deliberately not part of isCloudAIConfigured(): without it
  // `auth/analytics.ts` stays silent and everything else works unchanged. AI is
  // not gated on being measurable.
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID ?? "",
};

/** reCAPTCHA v3 site key for Firebase App Check (required to call AI Logic). */
export const recaptchaSiteKey = env.VITE_RECAPTCHA_SITE_KEY ?? "";

/**
 * Region the callable Cloud Functions deploy to (e.g. `europe-west1` to keep
 * image generation in the EU). Must match FUNCTION_REGION in functions/src —
 * the Functions SDK only looks in one region.
 */
export const functionsRegion = env.VITE_FIREBASE_FUNCTIONS_REGION ?? "us-central1";

// The Gemini model is no longer chosen here: each server prompt template names
// its own in frontmatter (see docs/prompt-templates/). Moving models is now a
// console change, not a redeploy — and a client cannot pick a costlier one.

/**
 * True only when the Firebase project is wired up. Until then the AI features
 * stay hidden/disabled and the app runs as a pure offline recipe book.
 *
 * `recaptchaSiteKey` counts as part of "wired up" on purpose. `ensureFirebase()`
 * skips App Check entirely when it's empty, so without this a build that lost
 * the variable would keep calling Gemini with no attestation at all and nothing
 * would say so — our main defence against someone reusing this (deliberately
 * public) config on our quota. Better to ship no AI than unprotected AI.
 */
export function isCloudAIConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.projectId &&
      firebaseConfig.appId &&
      recaptchaSiteKey,
  );
}
