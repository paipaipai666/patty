import { useState, useEffect, useCallback, useRef } from 'react'
import { useSettingsStore } from '../../store/settingsStore'
import type { AppSettings, CustomTheme, ShortcutMap } from '../../../shared/settingsTypes'
import { createDefaultCustomTheme, UI_COLOR_LABELS, XTERM_COLOR_LABELS } from '../../styles/themes'
import styles from './SettingsModal.module.css'

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

type Category = 'appearance' | 'terminal' | 'shortcuts' | 'layout'

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'appearance', label: 'Appearance' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'shortcuts', label: 'Shortcuts' },
  { key: 'layout', label: 'Layout' }
]

const SHELL_OPTIONS: { value: AppSettings['defaultShell']; label: string }[] = [
  { value: 'powershell', label: 'Windows PowerShell' },
  { value: 'pwsh', label: 'PowerShell 7' },
  { value: 'cmd', label: 'CMD' },
  { value: 'gitbash', label: 'Git Bash' },
  { value: 'wsl', label: 'WSL' }
]

const SHORTCUT_KEYS: { key: keyof ShortcutMap; label: string }[] = [
  { key: 'newTerminal', label: 'New Terminal' },
  { key: 'closeTerminal', label: 'Close Terminal' },
  { key: 'nextTab', label: 'Next Tab' },
  { key: 'prevTab', label: 'Previous Tab' },
  { key: 'toggleSidebar', label: 'Toggle Sidebar' },
  { key: 'settings', label: 'Open Settings' }
]

function formatShortcut(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Meta')
  const key = e.key
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key)
  }
  return parts.join('+')
}

export function SettingsModal() {
  const { settings, settingsOpen, closeSettings, updateSetting } = useSettingsStore()
  const [activeCategory, setActiveCategory] = useState<Category>('appearance')
  const [capturingShortcut, setCapturingShortcut] = useState<keyof ShortcutMap | null>(null)
  const captureRef = useRef<keyof ShortcutMap | null>(null)

  useEffect(() => {
    if (!settingsOpen) {
      setActiveCategory('appearance')
      setCapturingShortcut(null)
    }
  }, [settingsOpen])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (captureRef.current) {
          setCapturingShortcut(null)
          captureRef.current = null
        } else {
          closeSettings()
        }
        return
      }

      if (captureRef.current) {
        e.preventDefault()
        e.stopPropagation()
        const combo = formatShortcut(e)
        if (combo && !['Ctrl', 'Alt', 'Shift', 'Meta'].includes(combo)) {
          updateSetting('shortcuts', { ...settings.shortcuts, [captureRef.current]: combo })
          setCapturingShortcut(null)
          captureRef.current = null
        }
      }
    },
    [closeSettings, updateSetting, settings.shortcuts]
  )

  useEffect(() => {
    if (settingsOpen) {
      window.addEventListener('keydown', handleKeyDown, true)
      return () => window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [settingsOpen, handleKeyDown])

  const startCapture = (key: keyof ShortcutMap) => {
    setCapturingShortcut(key)
    captureRef.current = key
  }

  if (!settingsOpen) return null

  return (
    <div className={styles.overlay} onMouseDown={(e) => {
      if (e.target === e.currentTarget) closeSettings()
    }}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <span className={styles.title}>Settings</span>
          <button className={styles.closeBtn} onClick={closeSettings}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <nav className={styles.nav}>
            {CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                className={`${styles.navItem} ${activeCategory === cat.key ? styles.navItemActive : ''}`}
                onClick={() => setActiveCategory(cat.key)}
              >
                {cat.label}
              </button>
            ))}
          </nav>

          <div className={styles.content}>
            {activeCategory === 'appearance' && (
              <AppearanceSection settings={settings} updateSetting={updateSetting} />
            )}
            {activeCategory === 'terminal' && (
              <TerminalSection settings={settings} updateSetting={updateSetting} />
            )}
            {activeCategory === 'shortcuts' && (
              <ShortcutsSection
                shortcuts={settings.shortcuts}
                capturing={capturingShortcut}
                onStartCapture={startCapture}
              />
            )}
            {activeCategory === 'layout' && (
              <LayoutSection settings={settings} updateSetting={updateSetting} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FontPicker({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const [fonts, setFonts] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.terminalAPI.getFonts().then((systemFonts) => {
      setFonts(systemFonts.length > 0 ? systemFonts : FALLBACK_FONTS)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const filtered = fonts.filter((f) => f.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className={styles.fontPicker} ref={containerRef}>
      <input
        className={styles.fontPickerInput}
        value={open ? search : value}
        placeholder="Search fonts..."
        onFocus={() => { setSearch(''); setOpen(true) }}
        onChange={(e) => setSearch(e.target.value)}
      />
      {open && (
        <div className={styles.fontPickerList}>
          {filtered.length === 0 ? (
            <div className={styles.fontPickerEmpty}>No fonts found</div>
          ) : (
            filtered.map((font) => (
              <div
                key={font}
                className={`${styles.fontPickerItem} ${font === value ? styles.fontPickerItemActive : ''}`}
                onClick={() => { onChange(font); setOpen(false) }}
              >
                {font}
              </div>
            ))
          )}
        </div>
      )}
    </div>
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

  const handleNew = () => {
    const theme = createDefaultCustomTheme(`Theme ${customThemes.length + 1}`)
    onUpdateThemes([...customThemes, theme])
    setEditingId(theme.id)
    onSelectTheme(theme.id)
  }

  const handleDelete = (id: string) => {
    onUpdateThemes(customThemes.filter((t) => t.id !== id))
    if (editingId === id) setEditingId(null)
    if (currentTheme === id) onSelectTheme('dark')
  }

  const handleDuplicate = (theme: CustomTheme) => {
    const copy: CustomTheme = {
      ...theme,
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `${theme.name} (copy)`,
      ui: { ...theme.ui },
      terminal: { ...theme.terminal }
    }
    onUpdateThemes([...customThemes, copy])
    setEditingId(copy.id)
    onSelectTheme(copy.id)
  }

  const handleImport = async () => {
    const result = await window.terminalAPI.themeImport()
    if (result.success && result.theme) {
      onUpdateThemes([...customThemes, result.theme])
      setEditingId(result.theme.id)
      onSelectTheme(result.theme.id)
    }
  }

  const handleExport = (theme: CustomTheme) => {
    window.terminalAPI.themeExport(theme)
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
      if (!parsed.name || !parsed.ui || !parsed.terminal) {
        setJsonError('Invalid theme: missing name, ui, or terminal')
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
              <button className={styles.themeActionBtn} title="Apply" onClick={() => onSelectTheme(theme.id)}>✓</button>
              <button className={styles.themeActionBtn} title="Duplicate" onClick={(e) => { e.stopPropagation(); handleDuplicate(theme) }}>⧉</button>
              <button className={styles.themeActionBtn} title="Export" onClick={(e) => { e.stopPropagation(); handleExport(theme) }}>↓</button>
              <button className={styles.themeActionBtn} title="Delete" onClick={(e) => { e.stopPropagation(); handleDelete(theme.id) }}>✕</button>
            </div>
          </div>
        ))}
        <div className={styles.themeListActions}>
          <button className={styles.themeBtn} onClick={handleNew}>+ New Theme</button>
          <button className={styles.themeBtn} onClick={handleImport}>Import</button>
        </div>
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
                className={`${styles.segmentBtn} ${editorMode === 'visual' ? styles.segmentBtnActive : ''}`}
                onClick={() => setEditorMode('visual')}
              >
                Visual
              </button>
              <button
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
                <button className={styles.themeBtn} onClick={applyJsonEdit}>Apply</button>
                <button className={styles.themeBtn} onClick={() => setEditorMode('visual')}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AppearanceSection({
  settings,
  updateSetting
}: {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
}) {
  const isCustom = settings.theme !== 'dark' && settings.theme !== 'light'

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Theme</div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Color Theme</span>
        <div className={styles.segmentGroup}>
          <button
            className={`${styles.segmentBtn} ${settings.theme === 'dark' ? styles.segmentBtnActive : ''}`}
            onClick={() => updateSetting('theme', 'dark')}
          >
            Dark
          </button>
          <button
            className={`${styles.segmentBtn} ${settings.theme === 'light' ? styles.segmentBtnActive : ''}`}
            onClick={() => updateSetting('theme', 'light')}
          >
            Light
          </button>
          <button
            className={`${styles.segmentBtn} ${isCustom ? styles.segmentBtnActive : ''}`}
            onClick={() => {
              if (settings.customThemes.length > 0) {
                updateSetting('theme', settings.customThemes[0].id)
              } else {
                const theme = createDefaultCustomTheme('My Theme')
                updateSetting('customThemes', [theme])
                updateSetting('theme', theme.id)
              }
            }}
          >
            Custom
          </button>
        </div>
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
          <button className={styles.stepBtn} onClick={() => updateSetting('fontSize', Math.max(8, settings.fontSize - 1))}>-</button>
          <input
            type="number"
            className={styles.numberInput}
            value={settings.fontSize}
            min={8}
            max={32}
            onChange={(e) => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 8 && v <= 32) updateSetting('fontSize', v) }}
          />
          <button className={styles.stepBtn} onClick={() => updateSetting('fontSize', Math.min(32, settings.fontSize + 1))}>+</button>
        </div>
      </div>
    </div>
  )
}

function TerminalSection({
  settings,
  updateSetting
}: {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Cursor</div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Cursor Style</span>
        <div className={styles.segmentGroup}>
          {(['block', 'underline', 'bar'] as const).map((style) => (
            <button
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
        <div
          className={`${styles.toggle} ${settings.cursorBlink ? styles.toggleOn : ''}`}
          onClick={() => updateSetting('cursorBlink', !settings.cursorBlink)}
        >
          <div className={styles.toggleKnob} />
        </div>
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

      <div className={styles.sectionTitle}>Shell</div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Default Shell</span>
        <select
          className={styles.select}
          value={settings.defaultShell}
          onChange={(e) => updateSetting('defaultShell', e.target.value as AppSettings['defaultShell'])}
        >
          {SHELL_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}

function ShortcutsSection({
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
            <button className={styles.shortcutBtn} onClick={() => onStartCapture(key)}>
              {capturing === key ? 'Cancel' : 'Edit'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function LayoutSection({
  settings,
  updateSetting
}: {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Sidebar</div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Sidebar Position</span>
        <div className={styles.segmentGroup}>
          <button
            className={`${styles.segmentBtn} ${settings.sidebarPosition === 'left' ? styles.segmentBtnActive : ''}`}
            onClick={() => updateSetting('sidebarPosition', 'left')}
          >
            Left
          </button>
          <button
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
