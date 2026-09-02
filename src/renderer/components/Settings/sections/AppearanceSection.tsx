import { useState } from 'react'
import { themeRipple } from '../../../utils/themeRipple'
import { getThemeColors } from '../../../styles/themes'
import { toast } from '../../../store/toastStore'
import type { AppSettings, CustomTheme } from '../../../../shared/settingsTypes'
import {
  createDefaultCustomTheme,
  UI_COLOR_LABELS,
  XTERM_COLOR_LABELS,
  BUILTIN_THEMES
} from '../../../styles/themes'
import { Dropdown, type DropdownOption } from '../../App/Dropdown'
import styles from '../SettingsModal.module.css'

export interface SectionProps {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
}

function ThemePicker({
  value,
  customThemes,
  onChange
}: {
  value: string
  customThemes: CustomTheme[]
  onChange: (id: string) => void
}) {
  const options: DropdownOption<string>[] = [
    ...Object.entries(BUILTIN_THEMES).map(([id, theme]) => ({
      value: id,
      label: theme.name,
      group: 'Built-in'
    })),
    ...customThemes.map((t) => ({ value: t.id, label: t.name, group: 'Custom' }))
  ]

  return (
    <Dropdown
      value={value}
      options={options}
      ariaLabel="Color theme"
      onSelect={(id, mouse) => {
        if (id !== value) {
          // Ripple from the click position; keyboard selection falls back to
          // the viewport center.
          const theme = getThemeColors(id, customThemes)
          themeRipple(mouse?.x ?? window.innerWidth / 2, mouse?.y ?? window.innerHeight / 2, theme.ui['--bg-app'])
        }
        onChange(id)
      }}
    />
  )
}

const FALLBACK_FONTS = [
  'Cascadia Code',
  'Cascadia Mono',
  'Consolas',
  'Fira Code',
  'JetBrains Mono',
  'Source Code Pro',
  'Courier New',
  'monospace'
]

function FontPicker({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const [fonts, setFonts] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [requested, setRequested] = useState(false)

  // Fetch lazily when the dropdown first opens. `requested` guards against
  // repeat fetches (incl. React StrictMode's double-invoked effects) and is
  // reset on failure so a failed fetch can be retried by reopening.
  const loadFonts = () => {
    if (requested) return
    setRequested(true)
    setLoading(true)
    window.terminalAPI.getFonts().then((systemFonts) => {
      setFonts(systemFonts.length > 0 ? systemFonts : FALLBACK_FONTS)
      setLoading(false)
    }).catch(() => {
      setFonts(FALLBACK_FONTS)
      setLoading(false)
      setRequested(false)
    })
  }

  return (
    <Dropdown
      value={value}
      options={fonts.map((f) => ({ value: f, label: f }))}
      onSelect={onChange}
      searchable
      searchPlaceholder="Search fonts..."
      loading={loading}
      emptyText="No fonts found"
      ariaLabel="Font family"
      onOpen={loadFonts}
      display={value}
    />
  )
}

function ThemeEditor({
  customThemes,
  currentTheme,
  onUpdateThemes,
  onSelectTheme
}: {
  customThemes: CustomTheme[]
  currentTheme: string
  onUpdateThemes: (themes: CustomTheme[]) => void
  onSelectTheme: (themeId: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editorMode, setEditorMode] = useState<'visual' | 'json'>('visual')
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const editingTheme = customThemes.find((t) => t.id === editingId)

  const handleDelete = (id: string) => {
    onUpdateThemes(customThemes.filter((t) => t.id !== id))
    if (editingId === id) setEditingId(null)
    if (currentTheme === id) onSelectTheme('dark')
  }

  const handleDuplicate = (theme: CustomTheme) => {
    const copy: CustomTheme = {
      ...theme,
      id: crypto.randomUUID(),
      name: `${theme.name} (copy)`,
      ui: { ...theme.ui },
      terminal: { ...theme.terminal }
    }
    onUpdateThemes([...customThemes, copy])
    setEditingId(copy.id)
    onSelectTheme(copy.id)
  }

  const handleExport = (theme: CustomTheme) => {
    window.terminalAPI.themeExport(theme).then((result) => {
      if (!result.success && result.error) {
        toast(`Export failed: ${result.error}`)
      }
    })
  }

  const updateEditingTheme = (updater: (t: CustomTheme) => CustomTheme) => {
    if (!editingId) return
    onUpdateThemes(customThemes.map((t) => (t.id === editingId ? updater(t) : t)))
  }

  const startJsonEdit = () => {
    if (editingTheme) {
      setJsonText(JSON.stringify(editingTheme, null, 2))
      setJsonError(null)
    }
    setEditorMode('json')
  }

  const applyJsonEdit = () => {
    try {
      const parsed = JSON.parse(jsonText) as CustomTheme
      const isStringMap = (v: unknown): v is Record<string, string> =>
        typeof v === 'object' && v !== null && !Array.isArray(v) &&
        Object.values(v).every((x) => typeof x === 'string')
      if (typeof parsed.name !== 'string' || !isStringMap(parsed.ui) || !isStringMap(parsed.terminal)) {
        setJsonError('Invalid theme: name must be a string, ui/terminal must be string maps')
        return
      }
      updateEditingTheme(() => ({ ...parsed, id: editingId! }))
      setJsonError(null)
      setEditorMode('visual')
    } catch (err) {
      setJsonError(`JSON error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className={styles.themeEditor}>
      <div className={styles.themeList}>
        {customThemes.map((theme) => (
          <div
            key={theme.id}
            className={`${styles.themeItem} ${editingId === theme.id ? styles.themeItemActive : ''}`}
            onClick={() => setEditingId(theme.id)}
          >
            <span className={styles.themeItemName}>{theme.name}</span>
            <div className={styles.themeItemActions}>
              <button type="button" className={styles.themeActionBtn} title="Apply" aria-label="Apply theme" onClick={() => onSelectTheme(theme.id)}>✓</button>
              <button type="button" className={styles.themeActionBtn} title="Duplicate" aria-label="Duplicate theme" onClick={(e) => { e.stopPropagation(); handleDuplicate(theme) }}>⧉</button>
              <button type="button" className={styles.themeActionBtn} title="Export" aria-label="Export theme" onClick={(e) => { e.stopPropagation(); handleExport(theme) }}>↓</button>
              <button type="button" className={styles.themeActionBtn} title="Delete" aria-label="Delete theme" onClick={(e) => { e.stopPropagation(); handleDelete(theme.id) }}>✕</button>
            </div>
          </div>
        ))}
      </div>

      {editingTheme && (
        <div className={styles.themeDetail}>
          <div className={styles.themeDetailHeader}>
            <input
              className={styles.themeNameInput}
              value={editingTheme.name}
              onChange={(e) => updateEditingTheme((t) => ({ ...t, name: e.target.value }))}
            />
            <div className={styles.segmentGroup}>
              <button
                type="button"
                className={`${styles.segmentBtn} ${editorMode === 'visual' ? styles.segmentBtnActive : ''}`}
                onClick={() => setEditorMode('visual')}
              >
                Visual
              </button>
              <button
                type="button"
                className={`${styles.segmentBtn} ${editorMode === 'json' ? styles.segmentBtnActive : ''}`}
                onClick={startJsonEdit}
              >
                JSON
              </button>
            </div>
          </div>

          {editorMode === 'visual' ? (
            <div className={styles.colorSections}>
              <div className={styles.colorSection}>
                <div className={styles.colorSectionTitle}>UI Colors</div>
                <div className={styles.colorGrid}>
                  {(Object.keys(UI_COLOR_LABELS) as (keyof typeof UI_COLOR_LABELS)[]).map((key) => (
                    <label key={key} className={styles.colorItem}>
                      <input
                        type="color"
                        className={styles.colorInput}
                        value={editingTheme.ui[key]}
                        onChange={(e) => updateEditingTheme((t) => ({ ...t, ui: { ...t.ui, [key]: e.target.value } }))}
                      />
                      <span className={styles.colorLabel}>{UI_COLOR_LABELS[key]}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className={styles.colorSection}>
                <div className={styles.colorSectionTitle}>Terminal Colors</div>
                <div className={styles.colorGrid}>
                  {(Object.keys(XTERM_COLOR_LABELS) as (keyof typeof XTERM_COLOR_LABELS)[]).map((key) => (
                    <label key={key} className={styles.colorItem}>
                      <input
                        type="color"
                        className={styles.colorInput}
                        value={editingTheme.terminal[key]}
                        onChange={(e) => updateEditingTheme((t) => ({ ...t, terminal: { ...t.terminal, [key]: e.target.value } }))}
                      />
                      <span className={styles.colorLabel}>{XTERM_COLOR_LABELS[key]}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.jsonEditor}>
              <textarea
                className={styles.jsonTextarea}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                spellCheck={false}
              />
              {jsonError && <div className={styles.jsonError}>{jsonError}</div>}
              <div className={styles.jsonActions}>
                <button type="button" className={styles.themeBtn} onClick={applyJsonEdit}>Apply</button>
                <button type="button" className={styles.themeBtn} onClick={() => setEditorMode('visual')}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function AppearanceSection({ settings, updateSetting }: SectionProps) {
  const isBuiltin = settings.theme in BUILTIN_THEMES
  const isCustom = !isBuiltin

  const handleImport = async () => {
    const result = await window.terminalAPI.themeImport()
    if (result.success && result.theme) {
      updateSetting('customThemes', [...settings.customThemes, result.theme])
      updateSetting('theme', result.theme.id)
    } else if (result.error) {
      toast(`Import failed: ${result.error}`)
    }
  }

  const handleNew = () => {
    const theme = createDefaultCustomTheme(`Theme ${settings.customThemes.length + 1}`)
    updateSetting('customThemes', [...settings.customThemes, theme])
    updateSetting('theme', theme.id)
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Theme</div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Color Theme</span>
        <ThemePicker
          value={settings.theme}
          customThemes={settings.customThemes}
          onChange={(id) => updateSetting('theme', id)}
        />
      </div>
      <div className={styles.themeActions}>
        <button type="button" className={styles.themeBtn} onClick={handleImport}>Import</button>
        <button type="button" className={styles.themeBtn} onClick={handleNew}>New</button>
      </div>

      {isCustom && (
        <ThemeEditor
          customThemes={settings.customThemes}
          currentTheme={settings.theme}
          onUpdateThemes={(themes) => updateSetting('customThemes', themes)}
          onSelectTheme={(id) => updateSetting('theme', id)}
        />
      )}

      <div className={styles.sectionTitle}>Font</div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Font Family</span>
        <FontPicker value={settings.fontFamily} onChange={(font) => updateSetting('fontFamily', font)} />
      </div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Font Size</span>
        <div className={styles.stepper}>
          <button type="button" className={styles.stepBtn} onClick={() => updateSetting('fontSize', Math.max(8, settings.fontSize - 1))}>-</button>
          <input
            type="number"
            className={styles.numberInput}
            value={settings.fontSize}
            min={8}
            max={32}
            onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 8 && v <= 32) updateSetting('fontSize', v) }}
          />
          <button type="button" className={styles.stepBtn} onClick={() => updateSetting('fontSize', Math.min(32, settings.fontSize + 1))}>+</button>
        </div>
      </div>
    </div>
  )
}
