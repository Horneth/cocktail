/**
 * The app version, shown on the Settings screen so a build names itself when
 * you're checking which one a device is running.
 *
 * It comes from package.json's `version` (injected at build time by Vite's
 * `define` — see vite.config.ts). That field is the single source of truth:
 * bump it on every change, following semantic versioning, and the next build
 * reports the new number. No second constant to keep in sync.
 */
export const APP_VERSION = __APP_VERSION__
