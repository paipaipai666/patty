import type { CustomTheme, UITheme, XtermTheme } from '../../shared/settingsTypes'

export const DARK_UI: UITheme = {
  '--bg-titlebar': '#1c1c1f',
  '--bg-sidebar': '#1a1a1f',
  '--bg-main': '#0f0f12',
  '--bg-item-hover': '#26262e',
  '--bg-item-active': '#2d2d38',
  '--bg-statusbar': '#16161a',
  '--bg-input': '#23232a',
  '--bg-context-menu': '#2a2a33',
  '--text-primary': '#e8e8ec',
  '--text-secondary': '#888899',
  '--text-muted': '#55556a',
  '--border-subtle': 'rgba(255,255,255,0.06)',
  '--border-medium': 'rgba(255,255,255,0.12)',
  '--accent': '#6c6cff',
  '--btn-close-hover': '#e81123',
  '--btn-min-max-hover': 'rgba(255,255,255,0.1)'
}

export const LIGHT_UI: UITheme = {
  '--bg-titlebar': '#e8e8f0',
  '--bg-sidebar': '#f0f0f5',
  '--bg-main': '#ffffff',
  '--bg-item-hover': '#e0e0ea',
  '--bg-item-active': '#d0d0dc',
  '--bg-statusbar': '#eaeaf0',
  '--bg-input': '#ffffff',
  '--bg-context-menu': '#f5f5fa',
  '--text-primary': '#1a1a2e',
  '--text-secondary': '#555570',
  '--text-muted': '#8888a0',
  '--border-subtle': 'rgba(0,0,0,0.06)',
  '--border-medium': 'rgba(0,0,0,0.12)',
  '--accent': '#5b5bf7',
  '--btn-close-hover': '#e81123',
  '--btn-min-max-hover': 'rgba(0,0,0,0.08)'
}

export const DARK_XTERM: XtermTheme = {
  background: '#0f0f12',
  foreground: '#e8e8ec',
  cursor: '#e8e8ec',
  cursorAccent: '#0f0f12',
  selectionBackground: 'rgba(108, 108, 255, 0.3)',
  black: '#1a1a1f',
  red: '#f26b5b',
  green: '#4ec97c',
  yellow: '#f5a623',
  blue: '#4f8ef7',
  magenta: '#a78bfa',
  cyan: '#2dd4bf',
  white: '#c8c8d8',
  brightBlack: '#55556a',
  brightRed: '#f26b5b',
  brightGreen: '#4ec97c',
  brightYellow: '#f5a623',
  brightBlue: '#4f8ef7',
  brightMagenta: '#a78bfa',
  brightCyan: '#2dd4bf',
  brightWhite: '#ffffff'
}

export const LIGHT_XTERM: XtermTheme = {
  background: '#ffffff',
  foreground: '#1a1a2e',
  cursor: '#1a1a2e',
  cursorAccent: '#ffffff',
  selectionBackground: 'rgba(91, 91, 247, 0.2)',
  black: '#1a1a2e',
  red: '#d63031',
  green: '#00a854',
  yellow: '#e17a00',
  blue: '#2d6cdf',
  magenta: '#8b5cf6',
  cyan: '#00897b',
  white: '#3d3d56',
  brightBlack: '#8888a0',
  brightRed: '#d63031',
  brightGreen: '#00a854',
  brightYellow: '#e17a00',
  brightBlue: '#2d6cdf',
  brightMagenta: '#8b5cf6',
  brightCyan: '#00897b',
  brightWhite: '#1a1a2e'
}

export const UI_COLOR_LABELS: Record<keyof UITheme, string> = {
  '--bg-titlebar': 'Title Bar',
  '--bg-sidebar': 'Sidebar',
  '--bg-main': 'Main Background',
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
    ui: { ...DARK_UI },
    terminal: { ...DARK_XTERM }
  }
}
