import type { NotificationSettings } from '../../../../shared/settingsTypes'
import type { SectionProps } from './AppearanceSection'
import styles from '../SettingsModal.module.css'

const NOTIFICATION_TOGGLES: Array<{
  key: keyof NotificationSettings
  label: string
  desc: string
}> = [
  { key: 'claudeCode', label: 'Claude Code', desc: 'Show indicators for permission requests, questions, and errors' },
  { key: 'openCode', label: 'OpenCode', desc: 'Show indicators for permission requests, questions, and errors' },
  { key: 'codex', label: 'Codex CLI', desc: 'Show indicators when Codex CLI needs your attention' },
  { key: 'ohMyPi', label: 'Oh My Pi', desc: 'Show indicators when Oh My Pi needs your attention' }
]

export function NotificationsSection({ settings, updateSetting }: SectionProps) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Attention Notifications</div>
      <div className={styles.settingDesc}>
        Show attention indicators when AI tools need your input.
      </div>

      {NOTIFICATION_TOGGLES.map(({ key, label, desc }) => (
        <div className={styles.settingRow} key={key}>
          <div>
            <span className={styles.settingLabel}>{label}</span>
            <div className={styles.settingDesc}>{desc}</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.notifications[key]}
            className={`${styles.toggle} ${settings.notifications[key] ? styles.toggleOn : ''}`}
            onClick={() =>
              updateSetting('notifications', {
                ...settings.notifications,
                [key]: !settings.notifications?.[key]
              })
            }
          >
            <div className={styles.toggleKnob} />
          </button>
        </div>
      ))}

      <div className={styles.settingDesc} style={{ marginTop: '16px' }}>
        Toggling a tool off removes Patty's hooks from its config (Claude Code
        settings.json, Codex hooks.json, OpenCode/omp plugin files); toggling
        on reinstalls them.
      </div>
    </div>
  )
}
