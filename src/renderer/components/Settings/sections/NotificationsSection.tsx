import type { NotificationSettings } from '../../../../shared/settingsTypes'
import type { SectionProps } from './AppearanceSection'
import styles from '../SettingsModal.module.css'
import { useState } from 'react'
import { useSessionStore } from '../../../store/sessionStore'
import { toast } from '../../../store/toastStore'

const NOTIFICATION_TOGGLES: Array<{
  key: keyof NotificationSettings
  label: string
  desc: string
}> = [
  { key: 'claudeCode', label: 'Claude Code', desc: 'Show indicators for permission requests, questions, and errors' },
  { key: 'openCode', label: 'OpenCode', desc: 'Show indicators for permission requests, questions, and errors' },
  { key: 'codex', label: 'Codex CLI', desc: 'Show indicators when Codex CLI needs your attention' },
  { key: 'ohMyPi', label: 'Oh My Pi', desc: 'Show indicators when Oh My Pi needs your attention' },
  { key: 'qwenCode', label: 'Qwen Code', desc: 'Show indicators when Qwen Code needs your attention' },
  { key: 'copilotCli', label: 'GitHub Copilot CLI', desc: 'Show indicators when Copilot CLI needs your attention' }
]

export function NotificationsSection({ settings, updateSetting }: SectionProps) {
  const [testing, setTesting] = useState(false)
  const testNotification = async () => {
    setTesting(true)
    try {
      const sent = await window.terminalAPI.testDesktopNotification(useSessionStore.getState().activeSessionId)
      toast(sent ? 'Test notification sent. Check Windows notifications.' : 'Notifications are disabled or unavailable. Check Windows settings.')
    } catch {
      toast('Could not send notification. Check Windows notification settings.')
    } finally { setTesting(false) }
  }
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Windows Notifications</div>
      <div className={styles.settingRow}>
        <div>
          <span id="desktop-notifications-label" className={styles.settingLabel}>Notify while Patty is in the background</span>
          <div className={styles.settingDesc}>Approval requests, questions, and errors. Click a notification to return to its terminal.</div>
        </div>
        <button type="button" role="switch" aria-labelledby="desktop-notifications-label" aria-checked={settings.desktopNotifications}
          className={`${styles.toggle} ${settings.desktopNotifications ? styles.toggleOn : ''}`}
          onClick={() => { void updateSetting('desktopNotifications', !settings.desktopNotifications) }}>
          <div className={styles.toggleKnob} />
        </button>
      </div>
      <button type="button" className={styles.themeBtn} disabled={testing || !settings.desktopNotifications} onClick={() => { void testNotification() }}>
        {testing ? 'Sending…' : 'Send test notification'}
      </button>
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
        Toggling a tool off removes Patty's hooks from its config (Claude/Qwen
        settings.json, Codex hooks.json, Copilot hooks dir, OpenCode/omp plugin
        files); toggling on reinstalls them.
      </div>
    </div>
  )
}
