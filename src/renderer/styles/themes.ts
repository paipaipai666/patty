import type { CustomTheme, UITheme, XtermTheme } from '../../shared/settingsTypes'

export const DARK_UI: UITheme = {
  '--bg-app': '#0a0a0c',
  '--bg-titlebar': 'rgba(18,18,22,0.50)',
  '--bg-sidebar': 'rgba(18,18,22,0.50)',
  '--bg-main': 'rgba(10,10,12,0.40)',
  '--bg-terminal': '#0a0a0c',
  '--bg-item-hover': 'rgba(128,128,128,0.06)',
  '--bg-item-active': 'rgba(99,102,241,0.08)',
  '--bg-statusbar': 'rgba(18,18,22,0.50)',
  '--bg-input': 'rgba(128,128,128,0.06)',
  '--bg-context-menu': 'rgba(28,28,34,0.78)',
  '--text-primary': '#e6e6ed',
  '--text-secondary': '#90909e',
  '--text-muted': '#5c5c6a',
  '--border-subtle': 'rgba(255,255,255,0.05)',
  '--border-medium': 'rgba(255,255,255,0.08)',
  '--accent': '#6366f1',
  '--accent-alpha': 'rgba(99,102,241,0.12)',
  '--accent-glow': 'rgba(99,102,241,0.25)',
  '--bg-dropdown-menu': 'rgba(28,28,34,0.85)',
  '--btn-close-hover': '#e81123',
  '--btn-min-max-hover': 'rgba(255,255,255,0.08)'
}

export const LIGHT_UI: UITheme = {
  '--bg-app': '#f6f7f9',
  '--bg-titlebar': 'rgba(248,249,252,0.70)',
  '--bg-sidebar': 'rgba(248,249,252,0.70)',
  '--bg-main': 'rgba(255,255,255,0.40)',
  '--bg-terminal': '#ffffff',
  '--bg-item-hover': 'rgba(128,128,128,0.05)',
  '--bg-item-active': 'rgba(99,102,241,0.06)',
  '--bg-statusbar': 'rgba(248,249,252,0.55)',
  '--bg-input': 'rgba(0,0,0,0.04)',
  '--bg-context-menu': 'rgba(238,239,244,0.78)',
  '--text-primary': '#12121a',
  '--text-secondary': '#5a5a6e',
  '--text-muted': '#9292a8',
  '--border-subtle': 'rgba(0,0,0,0.04)',
  '--border-medium': 'rgba(0,0,0,0.07)',
  '--accent': '#6366f1',
  '--accent-alpha': 'rgba(99,102,241,0.08)',
  '--accent-glow': 'rgba(99,102,241,0.15)',
  '--bg-dropdown-menu': 'rgba(238,239,244,0.85)',
  '--btn-close-hover': '#e81123',
  '--btn-min-max-hover': 'rgba(0,0,0,0.05)'
}

export const DARK_XTERM: XtermTheme = {
  background: '#0a0a0c',
  foreground: '#e6e6ed',
  cursor: '#e6e6ed',
  cursorAccent: '#0a0a0c',
  selectionBackground: 'rgba(99, 102, 241, 0.3)',
  black: '#12121a',
  red: '#f87171',
  green: '#34d399',
  yellow: '#fbbf24',
  blue: '#818cf8',
  magenta: '#a78bfa',
  cyan: '#22d3ee',
  white: '#c8c8d0',
  brightBlack: '#5c5c6a',
  brightRed: '#f87171',
  brightGreen: '#34d399',
  brightYellow: '#fbbf24',
  brightBlue: '#818cf8',
  brightMagenta: '#a78bfa',
  brightCyan: '#22d3ee',
  brightWhite: '#ffffff'
}

export const LIGHT_XTERM: XtermTheme = {
  background: '#ffffff',
  foreground: '#12121a',
  cursor: '#12121a',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(99, 102, 241, 0.15)',
  black: '#12121a',
  red: '#dc2626',
  green: '#059669',
  yellow: '#d97706',
  blue: '#4f46e5',
  magenta: '#7c3aed',
  cyan: '#0d9488',
  white: '#3d3d50',
  brightBlack: '#9292a8',
  brightRed: '#dc2626',
  brightGreen: '#059669',
  brightYellow: '#d97706',
  brightBlue: '#4f46e5',
  brightMagenta: '#7c3aed',
  brightCyan: '#0d9488',
  brightWhite: '#12121a'
}

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
  '--btn-min-max-hover': 'Min/Max Button Hover'
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
  if (custom) return { ui: custom.ui, terminal: custom.terminal }
  if (theme === 'light') return { ui: LIGHT_UI, terminal: LIGHT_XTERM }
  return { ui: DARK_UI, terminal: DARK_XTERM }
}

export function applyTheme(theme: string, customThemes: CustomTheme[] = []): void {
  const { ui } = getThemeColors(theme, customThemes)
  const root = document.documentElement
  for (const [key, value] of Object.entries(ui)) {
    root.style.setProperty(key, value)
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
