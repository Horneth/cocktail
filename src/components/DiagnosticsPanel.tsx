import { useState, useSyncExternalStore } from 'react'
import { clearDebugLog, getDebugEntries, subscribeDebug } from '../debugLog'
import { needsRedirectSignIn } from '../auth/firebase'
import { firebaseConfig } from '../config'
import { APP_VERSION } from '../version'
import styles from './DiagnosticsPanel.module.css'

// On-screen replacement for the browser console, for debugging sign-in on a
// phone where there is none. Always available (collapsed) rather than gated
// behind a flag: the whole point is that it needs no setup on the device.
// Safe to keep long-term; delete it and `src/debugLog.ts` when done.

function environment(): Record<string, unknown> {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const win = typeof window !== 'undefined' ? window : undefined
  return {
    version: APP_VERSION,
    userAgent: nav?.userAgent,
    displayModeStandalone: win?.matchMedia?.('(display-mode: standalone)').matches,
    navigatorStandalone: (nav as (Navigator & { standalone?: boolean }) | undefined)?.standalone,
    wouldRedirect: needsRedirectSignIn(),
    authDomain: firebaseConfig.authDomain,
    projectId: firebaseConfig.projectId,
    signedInHint: (() => {
      try {
        return localStorage.getItem('cocktail.signedIn')
      } catch {
        return '(unavailable)'
      }
    })(),
    online: nav?.onLine,
    href: typeof location !== 'undefined' ? location.href : undefined,
  }
}

export function DiagnosticsPanel() {
  const entries = useSyncExternalStore(subscribeDebug, getDebugEntries)
  const [copied, setCopied] = useState(false)

  const env = environment()
  const newestFirst = [...entries].reverse()

  async function copy() {
    const text = JSON.stringify({ environment: env, log: entries }, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be denied (or absent); fall back to a console dump the
      // user can still read over remote debugging if they have it.
      console.log('[cocktails:diagnostics]\n' + text)
    }
  }

  return (
    <details className={styles.panel}>
      <summary className={styles.summary}>
        Diagnostics <span className={styles.count}>{entries.length}</span>
      </summary>

      <dl className={styles.env}>
        {Object.entries(env).map(([k, v]) => (
          <div key={k} className={styles.envRow}>
            <dt>{k}</dt>
            <dd>{String(v)}</dd>
          </div>
        ))}
      </dl>

      <div className={styles.actions}>
        <button type="button" className={styles.action} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy all'}
        </button>
        <button type="button" className={styles.action} onClick={clearDebugLog}>
          Clear
        </button>
      </div>

      <ol className={styles.log}>
        {newestFirst.length === 0 && <li className={styles.empty}>No events yet.</li>}
        {newestFirst.map((e, i) => (
          <li key={`${e.t}-${i}`} className={styles.entry}>
            <span className={styles.time}>{e.t.slice(11, 19)}</span>
            <span className={styles.scope}>{e.scope}</span>
            <span className={styles.msg}>
              {e.message}
              {e.detail && <span className={styles.detail}>{e.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
    </details>
  )
}
