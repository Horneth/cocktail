import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'

// Node 22+ ships its own `globalThis.localStorage` (the experimental Web Storage
// API). Vitest's jsdom environment does not overwrite globals that already
// exist, so on a recent Node the app ends up talking to Node's stub instead of
// jsdom's Storage — and without `--localstorage-file` that stub has no
// setItem/getItem at all, so every test touching preferences dies with
// "localStorage.setItem is not a function". CI on Node 22 didn't hit it; a
// developer on Node 25 sees five failures on a clean checkout.
//
// Install a real in-memory Storage whenever the ambient one is unusable.
if (typeof globalThis.localStorage?.setItem !== 'function') {
  const memory = new Map<string, string>()
  const storage: Storage = {
    get length() {
      return memory.size
    },
    key: (i) => [...memory.keys()][i] ?? null,
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => void memory.set(k, String(v)),
    removeItem: (k) => void memory.delete(k),
    clear: () => memory.clear(),
  }
  Object.defineProperty(globalThis, 'localStorage', {
    value: storage,
    configurable: true,
    writable: true,
  })
}
