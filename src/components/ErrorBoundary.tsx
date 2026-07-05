import { Component, type ReactNode } from 'react'
import styles from './ErrorBoundary.module.css'

interface Props {
  children: ReactNode
  /** changes to this value reset the boundary (e.g. the current route) */
  resetKey?: string
}
interface State {
  error: Error | null
}

/**
 * Catches render/runtime errors anywhere below it and shows a recovery card
 * instead of a blank white screen. Without this, one thrown exception unmounts
 * the whole React tree and the app looks dead until a full restart.
 *
 * "Reload" re-runs the app (usually enough — the data lives in IndexedDB and is
 * untouched). "Update app" additionally clears the service-worker + caches, for
 * the rare case a stale cached build is the cause.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props) {
    // navigating to a new route clears a prior screen's error
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error) {
    console.error('Render error caught by ErrorBoundary:', error)
  }

  private reload = () => {
    window.location.reload()
  }

  private hardReset = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations()
        await Promise.all(regs.map((r) => r.unregister()))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
    } catch {
      /* best effort */
    }
    // back to the home route, fresh
    window.location.href = window.location.pathname
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={styles.wrap} role="alert">
        <div className={styles.card}>
          <span className={styles.emoji} aria-hidden>
            🍸
          </span>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.body}>
            The screen hit an unexpected error. Your recipes are safe on this device — reloading
            usually fixes it.
          </p>
          <div className={styles.actions}>
            <button className={styles.primary} onClick={this.reload}>
              Reload
            </button>
            <button className={styles.ghost} onClick={this.hardReset}>
              Update app
            </button>
          </div>
          <details className={styles.details}>
            <summary>Error details</summary>
            <pre className={styles.pre}>{this.state.error.message}</pre>
          </details>
        </div>
      </div>
    )
  }
}
