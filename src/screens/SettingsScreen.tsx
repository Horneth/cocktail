import { useNavigate } from 'react-router-dom'
import { ChevronLeftIcon, SparkleIcon } from '../components/icons'
import { FEATURES } from '../config'
import { useAuth } from '../hooks/useAuth'
import styles from './SettingsScreen.module.css'

export function SettingsScreen() {
  const navigate = useNavigate()
  const auth = useAuth()

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
      </div>
    </div>
  )
}
