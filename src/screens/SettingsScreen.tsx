import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeftIcon, SparkleIcon } from '../components/icons'
import { FEATURES } from '../config'
import { DEFAULT_GEMINI_MODEL } from '../import/gemini'
import { useGeminiSettings } from '../hooks/useSettings'
import styles from './SettingsScreen.module.css'

export function SettingsScreen() {
  const navigate = useNavigate()
  const gemini = useGeminiSettings()
  const [show, setShow] = useState(false)

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
              <SparkleIcon size={16} className={styles.h2icon} /> AI parsing (optional)
            </h2>
            <p className={styles.desc}>
              Paste your own Google <strong>Gemini</strong> API key to unlock “Smart parse” when
              importing. It’s stored <strong>only on this device</strong> and is sent only to
              Google when you parse — never to this app’s server or repository.
            </p>

            <label className={styles.label}>Gemini API key</label>
            <div className={styles.keyRow}>
              <input
                className={styles.keyInput}
                type={show ? 'text' : 'password'}
                value={gemini.apiKey}
                onChange={(e) => gemini.setApiKey(e.target.value)}
                placeholder="AIza…"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <button className={styles.showBtn} onClick={() => setShow((s) => !s)}>
                {show ? 'Hide' : 'Show'}
              </button>
            </div>

            <div className={styles.actionRow}>
              <a
                className={styles.link}
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
              >
                Get a free key ↗
              </a>
              {gemini.hasKey && (
                <button className={styles.clearBtn} onClick={gemini.clear}>
                  Remove key
                </button>
              )}
            </div>

            <details className={styles.advanced}>
              <summary>Advanced</summary>
              <label className={styles.label}>Model</label>
              <input
                className={styles.keyInput}
                value={gemini.model}
                onChange={(e) => gemini.setModel(e.target.value)}
                placeholder={DEFAULT_GEMINI_MODEL}
                autoCorrect="off"
                spellCheck={false}
              />
            </details>

            <p className={styles.note}>
              For safety, create a key <strong>restricted to the “Generative Language API”</strong>{' '}
              (and optionally to your site’s domain) in Google Cloud, so a leak is low-impact. Basic
              (offline) parsing always works without a key.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
