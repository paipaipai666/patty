import { useId, type CSSProperties } from 'react'
import { Checkmark16Regular } from '@fluentui/react-icons'
import type { CustomTheme } from '../../../shared/settingsTypes'
import { BUILTIN_THEMES, getThemeColors } from '../../styles/themes'
import styles from './ThemePicker.module.css'

interface ThumbnailStyle extends CSSProperties {
  '--thumbnail-sidebar': string
  '--thumbnail-selection': string
  '--thumbnail-toolbar': string
  '--thumbnail-terminal': string
  '--thumbnail-text': string
  '--thumbnail-accent': string
  '--thumbnail-success': string
}

export function ThemePicker({ value, customThemes, onChange }: {
  value: string
  customThemes: CustomTheme[]
  onChange: (id: string) => void
}) {
  const name = useId()
  const builtins = Object.entries(BUILTIN_THEMES)
  const groups = [
    { label: 'Dark themes', options: builtins.filter(([, theme]) => theme.appearance === 'dark').map(([id, theme]) => ({ id, name: theme.name })) },
    { label: 'Light themes', options: builtins.filter(([, theme]) => theme.appearance === 'light').map(([id, theme]) => ({ id, name: theme.name })) },
    { label: 'Custom themes', options: customThemes }
  ]

  return <fieldset className={styles.picker}>
    <legend className={styles.legend}>Color theme</legend>
    {groups.filter(group => group.options.length > 0).map(group => <div className={styles.group} key={group.label}>
      <h3 className={styles.groupTitle}>{group.label}</h3>
      <div className={styles.grid}>
        {group.options.map(theme => {
          const colors = getThemeColors(theme.id, customThemes)
          const style: ThumbnailStyle = {
            '--thumbnail-sidebar': colors.ui['--bg-sidebar'],
            '--thumbnail-selection': colors.ui['--bg-item-active'],
            '--thumbnail-toolbar': colors.ui['--bg-titlebar'],
            '--thumbnail-terminal': colors.terminal.background,
            '--thumbnail-text': colors.terminal.foreground,
            '--thumbnail-accent': colors.ui['--accent'],
            '--thumbnail-success': colors.terminal.green
          }
          return <label className={styles.choice} key={theme.id} data-theme-id={theme.id} title={theme.name}>
            <input className={styles.radio} type="radio" name={name} value={theme.id} aria-label={theme.name} checked={value === theme.id} onChange={() => onChange(theme.id)} />
            <span className={styles.card}>
              <span className={styles.thumbnail} style={style} aria-hidden data-testid="theme-thumbnail">
                <span className={styles.toolbar}><span>Patty</span><span>− □ ×</span></span>
                <span className={styles.workspace}>
                  <span className={styles.sidebar}><span className={styles.selected} /><span /><span /></span>
                  <span className={styles.terminal}>
                    <span><span className={styles.prompt}>❯</span> npm test</span>
                    <span className={styles.success}>✓ passed</span>
                    <span className={styles.cursor} />
                  </span>
                </span>
              </span>
              <span className={styles.caption}><span className={styles.themeName}>{theme.name}</span>{value === theme.id && <span className={styles.current} aria-hidden><Checkmark16Regular />Current</span>}</span>
            </span>
          </label>
        })}
      </div>
    </div>)}
  </fieldset>
}
