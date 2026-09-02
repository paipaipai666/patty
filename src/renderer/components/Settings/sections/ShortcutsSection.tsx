import type { ShortcutMap } from '../../../../shared/settingsTypes'
import styles from '../SettingsModal.module.css'

const SHORTCUT_KEYS: { key: keyof ShortcutMap; label: string }[] = [
  { key: 'newTerminal', label: 'New Terminal' },
  { key: 'closeTerminal', label: 'Close Terminal' },
  { key: 'nextTab', label: 'Next Tab' },
  { key: 'prevTab', label: 'Previous Tab' },
  { key: 'toggleSidebar', label: 'Toggle Sidebar' },
  { key: 'settings', label: 'Open Settings' }
]

export function ShortcutsSection({
  shortcuts,
  capturing,
  onStartCapture
}: {
  shortcuts: ShortcutMap
  capturing: keyof ShortcutMap | null
  onStartCapture: (key: keyof ShortcutMap) => void
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Keyboard Shortcuts</div>
      {SHORTCUT_KEYS.map(({ key, label }) => (
        <div key={key} className={styles.shortcutRow}>
          <span className={styles.shortcutLabel}>{label}</span>
          <div className={styles.shortcutValue}>
            <span className={`${styles.shortcutKey} ${capturing === key ? styles.shortcutCapture : ''}`}>
              {capturing === key ? 'Press keys...' : shortcuts[key]}
            </span>
            <button type="button" className={styles.shortcutBtn} onClick={() => onStartCapture(key)}>
              {capturing === key ? 'Cancel' : 'Edit'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
