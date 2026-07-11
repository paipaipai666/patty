import { useState, useEffect, useCallback, useRef } from 'react'
import gsap from 'gsap'
import { themeRipple } from '../../utils/themeRipple'
import { getThemeColors } from '../../styles/themes'
import { useSettingsStore } from '../../store/settingsStore'
import { useAnimatedMount } from '../../hooks/useAnimatedMount'
import type { AppSettings, CustomTheme, ShellType, ShortcutMap } from '../../../shared/settingsTypes'
import { createDefaultCustomTheme, UI_COLOR_LABELS, XTERM_COLOR_LABELS, BUILTIN_THEMES } from '../../styles/themes'
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

type Category = 'appearance' | 'terminal' | 'shortcuts' | 'layout' | 'notifications'

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'appearance', label: 'Appearance' },
  { key: 'terminal', label: 'Terminal' },
  { key: 'shortcuts', label: 'Shortcuts' },
  { key: 'layout', label: 'Layout' },
  { key: 'notifications', label: 'Notifications' }
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
  const settings = useSettingsStore((s) => s.settings)
  const settingsOpen = useSettingsStore((s) => s.settingsOpen)
  const closeSettings = useSettingsStore((s) => s.closeSettings)
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const { mounted, exiting } = useAnimatedMount(settingsOpen, 200)
  const [activeCategory, setActiveCategory] = useState<Category>('appearance')
  const [capturingShortcut, setCapturingShortcut] = useState<keyof ShortcutMap | null>(null)
  const captureRef = useRef<keyof ShortcutMap | null>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const prevCategory = useRef<Category>('appearance')
  const previouslyFocused = useRef<HTMLElement | null>(null)

  // Modal entrance animation (after mount, not useLayoutEffect)
  useEffect(() => {
    if (!mounted || !modalRef.current) return
    const panel = modalRef.current
    const navItems = navRef.current?.children
    const fields = contentRef.current?.children

    const tl = gsap.timeline()
    tl.from(panel, {
      y: 24, scale: 0.96, opacity: 0,
      duration: 0.45, ease: 'back.out(1.2)',
      clearProps: 'transform,opacity'
    })
    if (navItems && navItems.length > 0) {
      tl.from(Array.from(navItems), {
        x: -12, opacity: 0,
        duration: 0.3, stagger: 0.04,
        ease: 'power2.out',
        clearProps: 'transform,opacity'
      }, '-=0.2')
    }
    if (fields && fields.length > 0) {
      tl.from(Array.from(fields), {
        y: 12, opacity: 0,
        duration: 0.3, stagger: 0.04,
        ease: 'power2.out',
        clearProps: 'transform,opacity'
      }, '-=0.2')
    }

    return () => { tl.kill() }
  }, [mounted])

  // Tab content crossfade animation
  useEffect(() => {
    if (!contentRef.current || prevCategory.current === activeCategory) return
    const children = contentRef.current.children
    if (children.length > 0) {
      gsap.from(Array.from(children), {
        y: 8, opacity: 0,
        duration: 0.3, ease: 'power2.out',
        clearProps: 'transform,opacity'
      })
    }
    prevCategory.current = activeCategory
  }, [activeCategory])

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

  // Focus trap: save/restore focus, keep Tab inside the modal
  useEffect(() => {
    if (!settingsOpen) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const modal = modalRef.current
    if (modal) {
      const focusable = modal.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      focusable?.focus()
    }

    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !modalRef.current) return
      const focusables = modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', trap)
    return () => {
      window.removeEventListener('keydown', trap)
      previouslyFocused.current?.focus?.()
    }
  }, [settingsOpen])

  const startCapture = (key: keyof ShortcutMap) => {
    setCapturingShortcut(key)
    captureRef.current = key
  }

  if (!mounted) return null

  return (
    <div className={`${styles.overlay} ${exiting ? styles.overlayExit : ''}`} onMouseDown={(e) => {
      if (e.target === e.currentTarget) closeSettings()
    }}>
      <div ref={modalRef} className={`${styles.modal} ${exiting ? styles.modalExit : ''}`} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className={styles.header}>
          <span id="settings-title" className={styles.title}>Settings</span>
          <button type="button" className={styles.closeBtn} onClick={closeSettings}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M0.5 0.5L9.5 9.5M9.5 0.5L0.5 9.5" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <nav className={styles.nav} ref={navRef}>
            {CATEGORIES.map((cat) => (
              <button
                type="button"
                key={cat.key}
                className={`${styles.navItem} ${activeCategory === cat.key ? styles.navItemActive : ''}`}
                onClick={() => setActiveCategory(cat.key)}
              >
                {cat.label}
              </button>
            ))}
          </nav>

          <div className={styles.content} ref={contentRef}>
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
            {activeCategory === 'notifications' && (
              <NotificationsSection settings={settings} updateSetting={updateSetting} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
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
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const builtinEntries = Object.entries(BUILTIN_THEMES)
  const currentName = BUILTIN_THEMES[value]?.name ?? customThemes.find((t) => t.id === value)?.name ?? value

  const handleSelect = (id: string, e: React.MouseEvent) => {
    if (id !== value) {
      // Trigger ripple from click position
      const theme = getThemeColors(id, customThemes)
      themeRipple(e.clientX, e.clientY, theme.ui['--bg-app'])
    }
    onChange(id)
    setOpen(false)
  }

  return (
    <div className={styles.fontPicker} ref={containerRef}>
      <input
        className={styles.fontPickerInput}
        value={currentName}
        readOnly
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className={styles.fontPickerList}>
          <div className={styles.themeGroupLabel}>Built-in</div>
          {builtinEntries.map(([id, theme]) => (
            <div
              key={id}
              className={`${styles.fontPickerItem} ${id === value ? styles.fontPickerItemActive : ''}`}
              onClick={(e) => handleSelect(id, e)}
            >
              {theme.name}
            </div>
          ))}
          {customThemes.length > 0 && (
            <>
              <div className={styles.themeGroupLabel}>Custom</div>
              {customThemes.map((t) => (
                <div
                  key={t.id}
                  className={`${styles.fontPickerItem} ${t.id === value ? styles.fontPickerItemActive : ''}`}
                  onClick={(e) => handleSelect(t.id, e)}
                >
                  {t.name}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function FontPicker({ value, onChange }: { value: string; onChange: (font: string) => void }) {
  const [fonts, setFonts] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const requestedRef = useRef(false)

  // Fetch lazily when the dropdown first opens. requestedRef guards against
  // repeat fetches (incl. React StrictMode's double-invoked effects) and is
  // reset on failure so a failed fetch can be retried by reopening.
  useEffect(() => {
    if (!open || requestedRef.current) return
    requestedRef.current = true
    setLoading(true)
    window.terminalAPI.getFonts().then((systemFonts) => {
      setFonts(systemFonts.length > 0 ? systemFonts : FALLBACK_FONTS)
      setLoading(false)
    }).catch(() => {
      setFonts(FALLBACK_FONTS)
      setLoading(false)
      requestedRef.current = false
    })
  }, [open])

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
          {loading ? (
            <div className={styles.fontPickerEmpty}>Loading fonts…</div>
          ) : filtered.length === 0 ? (
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

function ShellPicker({
  value,
  onChange
}: {
  value: ShellType
  onChange: (shell: ShellType) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const SHELL_OPTIONS: { value: ShellType; label: string }[] = [
    { value: 'powershell', label: 'Windows PowerShell' },
    { value: 'pwsh', label: 'PowerShell 7' },
    { value: 'cmd', label: 'CMD' },
    { value: 'gitbash', label: 'Git Bash' },
    { value: 'wsl', label: 'WSL' }
  ]

  const currentLabel = SHELL_OPTIONS.find((s) => s.value === value)?.label ?? value

  return (
    <div className={styles.fontPicker} ref={containerRef}>
      <input
        className={styles.fontPickerInput}
        value={currentLabel}
        readOnly
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className={styles.fontPickerList}>
          {SHELL_OPTIONS.map((s) => (
            <div
              key={s.value}
              className={`${styles.fontPickerItem} ${s.value === value ? styles.fontPickerItemActive : ''}`}
              onClick={() => { onChange(s.value); setOpen(false) }}
            >
              {s.label}
            </div>
          ))}
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

function AppearanceSection({
  settings,
  updateSetting
}: {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
}) {
  const isBuiltin = settings.theme in BUILTIN_THEMES
  const isCustom = !isBuiltin

  const handleImport = async () => {
    const result = await window.terminalAPI.themeImport()
    if (result.success && result.theme) {
      updateSetting('customThemes', [...settings.customThemes, result.theme])
      updateSetting('theme', result.theme.id)
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

      <div className={styles.sectionTitle}>Shell</div>
      <div className={styles.settingRow}>
        <span className={styles.settingLabel}>Default Shell</span>
        <ShellPicker value={settings.defaultShell} onChange={(shell) => updateSetting('defaultShell', shell)} />
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
            <button type="button" className={styles.shortcutBtn} onClick={() => onStartCapture(key)}>
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

function NotificationsSection({
  settings,
  updateSetting
}: {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>
}) {
  const toggleClaudeCode = () => {
    updateSetting('notifications', {
      ...settings.notifications,
      claudeCode: !settings.notifications?.claudeCode
    })
  }

  const toggleOpenCode = () => {
    updateSetting('notifications', {
      ...settings.notifications,
      openCode: !settings.notifications?.openCode
    })
  }

  const toggleCodex = () => {
    updateSetting('notifications', {
      ...settings.notifications,
      codex: !settings.notifications?.codex
    })
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Attention Notifications</div>
      <div className={styles.settingDesc}>
        Show attention indicators when AI tools need your input.
      </div>

      <div className={styles.settingRow}>
        <div>
          <span className={styles.settingLabel}>Claude Code</span>
          <div className={styles.settingDesc}>
            Show indicators for permission requests, questions, and errors
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.notifications.claudeCode}
          className={`${styles.toggle} ${settings.notifications.claudeCode ? styles.toggleOn : ''}`}
          onClick={toggleClaudeCode}
        >
          <div className={styles.toggleKnob} />
        </button>
      </div>

      <div className={styles.settingRow}>
        <div>
          <span className={styles.settingLabel}>OpenCode</span>
          <div className={styles.settingDesc}>
            Show indicators for permission requests, questions, and errors
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.notifications.openCode}
          className={`${styles.toggle} ${settings.notifications.openCode ? styles.toggleOn : ''}`}
          onClick={toggleOpenCode}
        >
          <div className={styles.toggleKnob} />
        </button>
      </div>

      <div className={styles.settingRow}>
        <div>
          <span className={styles.settingLabel}>Codex CLI</span>
          <div className={styles.settingDesc}>
            Show indicators when Codex CLI needs your attention
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={settings.notifications.codex}
          className={`${styles.toggle} ${settings.notifications.codex ? styles.toggleOn : ''}`}
          onClick={toggleCodex}
        >
          <div className={styles.toggleKnob} />
        </button>
      </div>

      <div className={styles.settingDesc} style={{ marginTop: '16px' }}>
        ℹ️ When disabled, external config files (Claude Code settings.json, OpenCode plugin, Codex hooks.json) will not be modified.
      </div>
    </div>
  )
}
