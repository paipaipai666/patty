import type { SectionProps } from './AppearanceSection'
import styles from '../SettingsModal.module.css'

export function LayoutSection({ settings, updateSetting }: SectionProps) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Sidebar</div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Sidebar Position</span>
        <div className={styles.segmentGroup}>
          <button
            type="button"
            className={`${styles.segmentBtn} ${settings.sidebarPosition === 'left' ? styles.segmentBtnActive : ''}`}
            onClick={() => updateSetting('sidebarPosition', 'left')}
          >
            Left
          </button>
          <button
            type="button"
            className={`${styles.segmentBtn} ${settings.sidebarPosition === 'right' ? styles.segmentBtnActive : ''}`}
            onClick={() => updateSetting('sidebarPosition', 'right')}
          >
            Right
          </button>
        </div>
      </div>
    </div>
  )
}
