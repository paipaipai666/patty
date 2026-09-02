import type { ShellType } from '../../../../shared/settingsTypes'
import { SHELL_LABELS } from '../../../../shared/settingsTypes'
import { Dropdown } from '../../App/Dropdown'
import type { SectionProps } from './AppearanceSection'
import styles from '../SettingsModal.module.css'

// Default-shell picker excludes 'ssh' — SSH sessions are created from hosts,
// not chosen as a local default. Object.entries loses the key type; restored here.
const SHELL_OPTIONS: { value: ShellType; label: string }[] = (
  Object.entries(SHELL_LABELS) as [ShellType, string][]
)
  .filter(([value]) => value !== 'ssh')
  .map(([value, label]) => ({ value, label }))

function ShellPicker({
  value,
  onChange
}: {
  value: ShellType
  onChange: (shell: ShellType) => void
}) {
  return (
    <Dropdown
      value={value}
      options={SHELL_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
      onSelect={(v) => onChange(v as ShellType)}
      ariaLabel="Default shell"
      display={SHELL_OPTIONS.find((s) => s.value === value)?.label ?? value}
    />
  )
}

export function TerminalSection({ settings, updateSetting }: SectionProps) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Cursor</div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Cursor Style</span>
        <div className={styles.segmentGroup}>
          {(['block', 'underline', 'bar'] as const).map((style) => (
            <button
              type="button"
              key={style}
              className={`${styles.segmentBtn} ${settings.cursorStyle === style ? styles.segmentBtnActive : ''}`}
              onClick={() => updateSetting('cursorStyle', style)}
            >
              {style.charAt(0).toUpperCase() + style.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.settingRow}>
        <div>
          <span className={styles.settingLabel}>Cursor Blink</span>
          <div className={styles.settingDesc}>Animate cursor blinking</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.cursorBlink}
          className={`${styles.toggle} ${settings.cursorBlink ? styles.toggleOn : ''}`}
          onClick={() => updateSetting('cursorBlink', !settings.cursorBlink)}
        >
          <div className={styles.toggleKnob} />
        </button>
      </div>

      <div className={styles.sectionTitle}>Display</div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Opacity</span>
        <div className={styles.settingControl}>
          <input
            type="range"
            className={styles.slider}
            min={40}
            max={100}
            value={Math.round(settings.opacity * 100)}
            onChange={(e) => updateSetting('opacity', parseInt(e.target.value) / 100)}
          />
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)', minWidth: '32px', textAlign: 'right' }}>
            {Math.round(settings.opacity * 100)}%
          </span>
        </div>
      </div>
      <div className={styles.settingRow}>
        <div>
          <span className={styles.settingLabel}>Scrollback</span>
          <div className={styles.settingDesc}>Lines kept per terminal; lower uses less memory. Applies to new terminals</div>
        </div>
        <div className={styles.segmentGroup}>
          {[1000, 2000, 5000, 10000].map((n) => (
            <button
              type="button"
              key={n}
              className={`${styles.segmentBtn} ${settings.scrollback === n ? styles.segmentBtnActive : ''}`}
              onClick={() => updateSetting('scrollback', n)}
            >
              {n / 1000}k
            </button>
          ))}
        </div>
      </div>

      <div className={styles.sectionTitle}>Shell</div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Default Shell</span>
        <ShellPicker value={settings.defaultShell} onChange={(shell) => updateSetting('defaultShell', shell)} />
      </div>
    </div>
  )
}
