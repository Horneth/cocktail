import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeftIcon, ImportIcon, SparkleIcon } from '../components/icons'
import { FEATURES } from '../config'
import { backupFilename, exportBackup, importBackup, parseBackup } from '../import/backup'
import { useAuth } from '../hooks/useAuth'
import styles from './SettingsScreen.module.css'

export function SettingsScreen() {
  const navigate = useNavigate()
  const auth = useAuth()
  const fileInput = useRef<HTMLInputElement>(null)
  const [dataStatus, setDataStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

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
          <section className={styles.section}>
            <h2 className={styles.h2}>
              <SparkleIcon size={16} className={styles.h2icon} /> AI features (optional)
            </h2>

            {!auth.configured ? (
              <p className={styles.desc}>
                Cloud AI isn’t set up for this build. Basic (offline) recipe parsing always works
                without it. To enable “Smart parse” and “Scan my shelf”, configure a Firebase
                project (see <code>docs/cloud-ai-backend.md</code>).
              </p>
            ) : (
              <>
                <p className={styles.desc}>
                  Sign in with Google to unlock <strong>Smart parse</strong> (messy descriptions →
                  clean recipes) and <strong>Scan my shelf</strong> (photos → bottles). Requests run
                  through Google — <strong>no API key is stored in this app</strong>, and your login
                  is used only to run those AI features. Everything else works signed out.
                </p>

                {auth.user ? (
                  <div className={styles.actionRow}>
                    <span className={styles.desc}>
                      Signed in as <strong>{auth.user.email ?? auth.user.displayName ?? 'your account'}</strong>
                    </span>
                    <button className={styles.clearBtn} onClick={() => void auth.signOut()}>
                      Sign out
                    </button>
                  </div>
                ) : (
                  <div className={styles.actionRow}>
                    <button className={styles.showBtn} onClick={() => void auth.signIn()}>
                      Sign in with Google
                    </button>
                  </div>
                )}

                <p className={styles.note}>
                  Usage is rate-limited per account. Basic (offline) parsing always works without
                  signing in.
                </p>
              </>
            )}
          </section>
        )}

        <section className={styles.section}>
          <h2 className={styles.h2}>
            <ImportIcon size={16} className={styles.h2icon} /> Your data
          </h2>
          <p className={styles.desc}>
            Everything you save lives in <strong>this browser</strong> — nothing is uploaded. That
            also means it doesn’t follow you to another device, or to this app on another address.
            Export a file here, then import it there.
          </p>

          <div className={styles.dataRow}>
            <button className={styles.dataBtn} onClick={handleExport}>
              Export backup
            </button>
            <button className={styles.dataBtn} onClick={() => fileInput.current?.click()}>
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
              className={dataStatus.kind === 'error' ? styles.dataError : styles.dataOk}
              role="status"
            >
              {dataStatus.text}
            </p>
          )}

          <p className={styles.note}>
            Importing <strong>replaces</strong> your whole library rather than merging into it.
          </p>
        </section>
      </div>
    </div>
  )
}
