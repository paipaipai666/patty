import type { ShortcutMap } from '../../../../shared/settingsTypes'
import { SHORTCUT_DEFINITIONS } from '../../../commands/shortcuts'
import styles from '../SettingsModal.module.css'

export function ShortcutsSection({
  shortcuts,
  capturing,
  error,
  onStartCapture
}: {
  shortcuts: ShortcutMap
  capturing: keyof ShortcutMap | null
  error: string | null
  onStartCapture: (key: keyof ShortcutMap) => void
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Keyboard Shortcuts</div>
      {error && <p role="alert">{error}</p>}
      {SHORTCUT_DEFINITIONS.map(({ key, label }) => (
        <div key={key} className={styles.shortcutRow}>
          <span className={styles.shortcutLabel}>{label}</span>
          <div className={styles.shortcutValue}>
            <span className={`${styles.shortcutKey} ${capturing === key ? styles.shortcutCapture : ''}`}>
              {capturing === key ? 'Press keys...' : shortcuts[key]}
            </span>
            <button type="button" className={styles.shortcutBtn} aria-label={`${capturing === key ? 'Cancel' : 'Edit'} ${label.toLowerCase()} shortcut`} onClick={() => onStartCapture(key)}>
              {capturing === key ? 'Cancel' : 'Edit'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
