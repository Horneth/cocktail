import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BottleIcon,
  ChevronLeftIcon,
  DownloadIcon,
  GoogleIcon,
  SparkleIcon,
  UploadIcon,
} from '../components/icons'
import { FEATURES } from '../config'
import { backupFilename, exportBackup, importBackup, parseBackup } from '../import/backup'
import { useAuth } from '../hooks/useAuth'
import { useAssumeStaples } from '../hooks/useSettings'
import styles from './SettingsScreen.module.css'

export function SettingsScreen() {
  const navigate = useNavigate()
  const auth = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)
  const [assumeStaples, setAssumeStaples] = useAssumeStaples()
  const [dataStatus, setDataStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [authError, setAuthError] = useState<string | null>(null)

  async function handleSignIn() {
    setAuthError(null)
    try {
      await auth.signIn()
    } catch {
      // Closing the Google popup rejects; that's a cancel, not a failure worth
      // shouting about — but it must not surface as an unhandled rejection.
      setAuthError('Sign-in didn’t complete.')
    }
  }

  async function handleExport() {
    try {
      const backup = await exportBackup()
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
      )
      const a = document.createElement('a')
      a.href = url
      a.download = backupFilename(backup.exportedAt)
      // Firefox only follows an anchor that's in the document, and Safari/iOS
      // aborts the download if the blob URL is revoked in the same tick — hence
      // the append and the deferred revoke.
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      const count = backup.data.recipes.length
      setDataStatus({ kind: 'ok', text: `Saved ${count} recipe${count === 1 ? '' : 's'}.` })
    } catch (err) {
      setDataStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Export failed.' })
    }
  }

  async function handleImportFile(file: File) {
    try {
      // Parse (and reject) before asking: no point warning about replacing the
      // library if the file was never going to load.
      const backup = parseBackup(await file.text())
      const count = backup.data.recipes.length
      const ok = confirm(
        `Load ${count} recipe${count === 1 ? '' : 's'} from this backup?\n\n` +
          'This REPLACES everything currently on this device — recipes, notes and bars.',
      )
      if (!ok) return
      await importBackup(backup)
      setDataStatus({ kind: 'ok', text: `Restored ${count} recipe${count === 1 ? '' : 's'}.` })
    } catch (err) {
      setDataStatus({ kind: 'error', text: err instanceof Error ? err.message : 'Import failed.' })
    }
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button className={styles.back} aria-label="Back" onClick={() => navigate(-1)}>
          <ChevronLeftIcon size={20} />
        </button>
        <h1 className={styles.headTitle}>Settings</h1>
      </header>

      <div className={styles.body}>
        {FEATURES.cloudAI && (
          <section>
            <div className={styles.eyebrowRow}>
              <h2 className={styles.eyebrow}>AI features</h2>
              {auth.configured && !auth.user && (
                <span className={styles.badge}>Sign-in required</span>
              )}
            </div>

            {!auth.configured ? (
              <div className={styles.card}>
                <p className={styles.off}>Not available in this build.</p>
              </div>
            ) : (
              <>
                <div className={styles.card}>
                  <div className={styles.perk}>
                    <span className={styles.perkIcon}>
                      <SparkleIcon size={17} />
                    </span>
                    <span className={styles.perkText}>
                      <strong>Import a recipe</strong>
                      <small>Pasted description → recipe</small>
                    </span>
                  </div>
                  <div className={styles.perk}>
                    <span className={styles.perkIcon}>
                      <BottleIcon size={17} />
                    </span>
                    <span className={styles.perkText}>
                      <strong>Scan my shelf</strong>
                      <small>Photo → bottles</small>
                    </span>
                  </div>

                  <div className={styles.account}>
                    {auth.user ? (
                      <>
                        <span className={styles.accountText}>
                          <small>Signed in</small>
                          <strong>
                            {auth.user.email ?? auth.user.displayName ?? 'Google account'}
                          </strong>
                        </span>
                        <button className={styles.ghostBtn} onClick={() => void auth.signOut()}>
                          Sign out
                        </button>
                      </>
                    ) : (
                      <button
                        className={styles.googleBtn}
                        onClick={() => void handleSignIn()}
                        disabled={!auth.ready}
                      >
                        <GoogleIcon size={18} />
                        {auth.ready ? 'Sign in with Google' : 'Checking…'}
                      </button>
                    )}
                  </div>
                </div>

                {authError && (
                  <p className={styles.authError} role="status">
                    {authError}
                  </p>
                )}
                <p className={styles.hint}>
                  Sign-in unlocks these two only. Everything else works offline, signed out.
                </p>
              </>
            )}
          </section>
        )}

        <section>
          <h2 className={styles.eyebrow}>Bar</h2>
          <label className={styles.toggle}>
            <span className={styles.toggleText}>
              <strong>Assume I have the basics</strong>
              <span className={styles.toggleHint}>
                water, ice, citrus, sugar, sodas, garnishes, egg
              </span>
            </span>
            <input
              type="checkbox"
              className={styles.switch}
              checked={assumeStaples}
              onChange={(e) => setAssumeStaples(e.target.checked)}
            />
          </label>
          <p className={styles.hint}>
            Counts usual bar staples as on-hand, so “ready to pour” reflects the
            bottles you actually own.
          </p>
        </section>

        <section>
          <h2 className={styles.eyebrow}>Backup</h2>
          <div className={styles.card}>
            <div className={styles.dataRow}>
              <button className={styles.dataBtn} onClick={handleExport}>
                <DownloadIcon size={17} />
                Export backup
              </button>
              <button className={styles.dataBtn} onClick={() => fileInput.current?.click()}>
                <UploadIcon size={17} />
                Import backup
              </button>
            </div>

            <input
              ref={fileInput}
              className={styles.hiddenFile}
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0]
                // Reset first, so picking the same file twice still fires onChange.
                e.target.value = ''
                if (file) void handleImportFile(file)
              }}
            />

            {dataStatus && (
              <p
                className={dataStatus.kind === 'error' ? styles.error : styles.ok}
                role="status"
              >
                {dataStatus.text}
              </p>
            )}
          </div>
          <p className={styles.hint}>Importing replaces your library — it doesn’t merge.</p>
        </section>
      </div>

      <p className={styles.footer}>Your library lives on this device only.</p>
    </div>
  )
}
