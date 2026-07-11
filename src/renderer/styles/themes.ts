import type { CustomTheme, UITheme, XtermTheme } from '../../shared/settingsTypes'
import darkJson from '../themes/dark.json'
import lightJson from '../themes/light.json'
import draculaJson from '../themes/dracula.json'
import nordJson from '../themes/nord.json'
import tokyoNightJson from '../themes/tokyo-night.json'
import solarizedLightJson from '../themes/solarized-light.json'

// Primary: from JSON files
export const DARK_UI: UITheme = darkJson.ui as UITheme
export const LIGHT_UI: UITheme = lightJson.ui as UITheme
export const DARK_XTERM: XtermTheme = darkJson.terminal as XtermTheme
export const LIGHT_XTERM: XtermTheme = lightJson.terminal as XtermTheme

// All built-in themes (key = theme id used in settings)
export const BUILTIN_THEMES: Record<string, { name: string; ui: UITheme; terminal: XtermTheme }> = {
  dark: { name: darkJson.name, ui: DARK_UI, terminal: DARK_XTERM },
  light: { name: lightJson.name, ui: LIGHT_UI, terminal: LIGHT_XTERM },
  dracula: { name: draculaJson.name, ui: draculaJson.ui as UITheme, terminal: draculaJson.terminal as XtermTheme },
  nord: { name: nordJson.name, ui: nordJson.ui as UITheme, terminal: nordJson.terminal as XtermTheme },
  'tokyo-night': { name: tokyoNightJson.name, ui: tokyoNightJson.ui as UITheme, terminal: tokyoNightJson.terminal as XtermTheme },
  'solarized-light': { name: solarizedLightJson.name, ui: solarizedLightJson.ui as UITheme, terminal: solarizedLightJson.terminal as XtermTheme }
}

// Fallback defaults (covers any field missing from imported JSON)
const UI_DEFAULTS = { ...DARK_UI } as UITheme
const XTERM_DEFAULTS = { ...DARK_XTERM } as XtermTheme

export const UI_COLOR_LABELS: Record<keyof UITheme, string> = {
  '--bg-app': 'App Background',
  '--bg-titlebar': 'Title Bar',
  '--bg-sidebar': 'Sidebar',
  '--bg-main': 'Main Background',
  '--bg-terminal': 'Terminal Background',
  '--bg-item-hover': 'Item Hover',
  '--bg-item-active': 'Item Active',
  '--bg-statusbar': 'Status Bar',
  '--bg-input': 'Input',
  '--bg-context-menu': 'Context Menu',
  '--text-primary': 'Primary Text',
  '--text-secondary': 'Secondary Text',
  '--text-muted': 'Muted Text',
  '--border-subtle': 'Subtle Border',
  '--border-medium': 'Medium Border',
  '--accent': 'Accent',
  '--accent-alpha': 'Accent Alpha',
  '--accent-glow': 'Accent Glow',
  '--bg-dropdown-menu': 'Dropdown Menu',
  '--btn-close-hover': 'Close Button Hover',
  '--btn-min-max-hover': 'Min/Max Button Hover',

  '--ai-claude-color': 'AI Claude Icon',
  '--ai-claude-bg': 'AI Claude Background',
  '--ai-claude-glow': 'AI Claude Glow',
  '--ai-opencode-color': 'AI OpenCode Icon',
  '--ai-opencode-bg': 'AI OpenCode Background',
  '--ai-opencode-glow': 'AI OpenCode Glow',
  '--ai-codex-color': 'AI Codex Icon',
  '--ai-codex-bg': 'AI Codex Background',
  '--ai-codex-glow': 'AI Codex Glow',

  '--fire-claude': 'Fire Claude',
  '--fire-opencode': 'Fire OpenCode',
  '--fire-codex': 'Fire Codex',
  '--fire-glow-claude-3': 'Fire Claude Glow (low)',
  '--fire-glow-claude-4': 'Fire Claude Glow (high)',
  '--fire-glow-opencode-3': 'Fire OpenCode Glow (low)',
  '--fire-glow-opencode-4': 'Fire OpenCode Glow (high)',
  '--fire-glow-codex-3': 'Fire Codex Glow (low)',
  '--fire-glow-codex-4': 'Fire Codex Glow (high)',
  '--fire-gradient-claude': 'Fire Claude Gradient',
  '--fire-gradient-opencode': 'Fire OpenCode Gradient',
  '--fire-gradient-codex': 'Fire Codex Gradient',

  '--attention-complete-bg': 'Attention Complete BG',
  '--attention-complete-bar': 'Attention Complete Bar',
  '--attention-complete-glow': 'Attention Complete Glow',
  '--attention-permission-bg': 'Attention Permission BG',
  '--attention-permission-bar': 'Attention Permission Bar',
  '--attention-permission-glow': 'Attention Permission Glow',
  '--attention-error-bg': 'Attention Error BG',
  '--attention-error-bar': 'Attention Error Bar',
  '--attention-error-glow': 'Attention Error Glow',

  '--overlay-bg': 'Overlay Background',
  '--scrollbar-thumb': 'Scrollbar Thumb',
  '--neutral': 'Neutral Gray',
  '--neutral-4': 'Neutral 4%',
  '--neutral-5': 'Neutral 5%',
  '--neutral-6': 'Neutral 6%',
  '--neutral-8': 'Neutral 8%',
  '--neutral-10': 'Neutral 10%',
  '--neutral-20': 'Neutral 20%',
  '--accent-glow-subtle': 'Accent Glow Subtle',
  '--accent-glow-soft': 'Accent Glow Soft',
  '--accent-glow-light': 'Accent Glow Light',
  '--accent-border': 'Accent Border',
  '--accent-glow-strong': 'Accent Glow Strong',
  '--accent-hover': 'Accent Hover',
  '--cyan-glow-soft': 'Cyan Glow Soft',
  '--cyan-glow': 'Cyan Glow',
  '--cyan-glow-light': 'Cyan Glow Light',
  '--cyan-glow-medium': 'Cyan Glow Medium',
  '--green-glow': 'Green Glow',
  '--red-glow': 'Red Glow',
  '--bg-error': 'Error Background',
  '--btn-close-hover-alpha': 'Close Button Hover Alpha',
  '--text-separator': 'Text Separator',
  '--btn-close-text': 'Close Button Text',
  '--btn-active-text': 'Active Button Text',
  '--surface-highlight': 'Surface Highlight',
  '--green': 'Green',
  '--red': 'Red',
  '--cyan': 'Cyan',
  '--amber': 'Amber',

  '--bg-hover': 'Background Hover',
  '--bg-tertiary': 'Tertiary Background',
  '--text-tertiary': 'Tertiary Text',
  '--border-light': 'Light Border',
  '--border-strong': 'Strong Border',
  '--color-amber': 'Amber (Semantic)',
  '--color-gray': 'Gray (Semantic)',
  '--indigo': 'Indigo (Semantic)'
}

export const XTERM_COLOR_LABELS: Record<keyof XtermTheme, string> = {
  background: 'Background',
  foreground: 'Foreground',
  cursor: 'Cursor',
  cursorAccent: 'Cursor Text',
  selectionBackground: 'Selection',
  black: 'Black',
  red: 'Red',
  green: 'Green',
  yellow: 'Yellow',
  blue: 'Blue',
  magenta: 'Magenta',
  cyan: 'Cyan',
  white: 'White',
  brightBlack: 'Bright Black',
  brightRed: 'Bright Red',
  brightGreen: 'Bright Green',
  brightYellow: 'Bright Yellow',
  brightBlue: 'Bright Blue',
  brightMagenta: 'Bright Magenta',
  brightCyan: 'Bright Cyan',
  brightWhite: 'Bright White'
}

export function getThemeColors(theme: string, customThemes: CustomTheme[] = []): { ui: UITheme; terminal: XtermTheme } {
  const custom = customThemes.find((t) => t.id === theme)
  if (custom) return {
    ui: { ...UI_DEFAULTS, ...custom.ui } as UITheme,
    terminal: { ...XTERM_DEFAULTS, ...custom.terminal } as XtermTheme
  }
  const builtin = BUILTIN_THEMES[theme]
  if (builtin) return {
    ui: { ...UI_DEFAULTS, ...builtin.ui } as UITheme,
    terminal: { ...XTERM_DEFAULTS, ...builtin.terminal } as XtermTheme
  }
  return {
    ui: { ...UI_DEFAULTS, ...DARK_UI } as UITheme,
    terminal: { ...XTERM_DEFAULTS, ...DARK_XTERM } as XtermTheme
  }
}

// Module-level cache to diff against previous theme application
const _appliedThemeCache = new Map<string, string>()

export function applyTheme(theme: string, customThemes: CustomTheme[] = []): void {
  const { ui } = getThemeColors(theme, customThemes)
  const root = document.documentElement

  // Apply only changed or new properties
  for (const [key, value] of Object.entries(ui)) {
    if (_appliedThemeCache.get(key) !== value) {
      root.style.setProperty(key, value)
      _appliedThemeCache.set(key, value)
    }
  }

  // Remove properties that existed in the old theme but not in the new one
  for (const key of _appliedThemeCache.keys()) {
    if (!(key in ui)) {
      root.style.removeProperty(key)
      _appliedThemeCache.delete(key)
    }
  }
}

export function applyFontSettings(fontFamily: string, fontSize: number): void {
  const root = document.documentElement
  root.style.setProperty('--font-mono', `'${fontFamily}', Consolas, 'Courier New', monospace`)
  root.style.setProperty('--font-size-term', `${fontSize}px`)
}

export function createDefaultCustomTheme(name: string): CustomTheme {
  return {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    ui: { ...DARK_UI } as UITheme,
    terminal: { ...DARK_XTERM }
  }
}
