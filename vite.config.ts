/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Firebase Hosting serves the app at the site root, so the base path is a
// constant. (It used to be CI-injected: GitHub Pages served project sites under
// /<repo>/, which forced a BASE_PATH env var through the manifest's start_url,
// scope and share_target. Moving off Pages retired all of that.)
const base = '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  build: {
    rollupOptions: {
      output: {
        // Keep the Firebase SDK in its own chunk so it only loads when a user
        // opens an AI screen — and so we can keep it out of the SW precache.
        manualChunks(id) {
          if (id.includes('node_modules/firebase') || id.includes('node_modules/@firebase')) {
            return 'firebase'
          }
        },
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Cocktails',
        short_name: 'Cocktails',
        description: 'Catalogue cocktails and the bottles you own — see what you can pour right now. Offline, instant, yours.',
        theme_color: '#F6F4EF',
        background_color: '#F6F4EF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        // Android Web Share Target: lets you hit "Share" on a YouTube video and
        // pick this app. The browser GETs the start URL with the shared fields as
        // query params; main.tsx picks them up and routes into Import.
        share_target: {
          action: base,
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // The Firebase SDK is large and only needed for the optional AI
        // features — fetch it on demand at runtime instead of bloating the
        // first-install precache.
        globIgnores: ['**/firebase-*.js'],
        // Cache the Google-hosted webfonts so the redesign's type still works
        // fully offline after the first online load (offline-first is core).
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Generated cocktail photos live only in Firebase Storage (the pool
          // is content-addressed by drink name). Cached on first view so they
          // render offline afterwards; not precached — entries exist per
          // generated drink and the app must install light.
          {
            urlPattern: /^https:\/\/firebasestorage\.googleapis\.com\/.*\/generated\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cocktail-images-pool',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Tool worktrees (e.g. `.claude/worktrees/*`) live inside the repo and would
    // otherwise be swept up by the default `**/*.test.*` glob — running their
    // own node_modules against a mismatched React, and double-counting names.
    // Anchor the suite to the real source; every test lives under `src/`.
    include: ['src/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
})
