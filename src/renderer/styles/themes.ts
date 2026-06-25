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
  '--btn-min-max-hover': 'rgba(255,255,255,0.08)',

  /* AI icon colors */
  '--ai-claude-color': '#d97757',
  '--ai-claude-bg': 'rgba(217,119,87,0.12)',
  '--ai-claude-glow': 'rgba(217,119,87,0.25)',
  '--ai-opencode-color': 'rgba(255,255,255,0.8)',
  '--ai-opencode-bg': 'rgba(255,255,255,0.06)',
  '--ai-opencode-glow': 'rgba(255,255,255,0.12)',

  /* Fire effect - ContributionGrid */
  '--fire-claude': '#cc785c',
  '--fire-opencode': '#ffffff',
  '--fire-glow-claude-3': 'rgba(204, 120, 92, 0.25)',
  '--fire-glow-claude-4': 'rgba(204, 120, 92, 0.5)',
  '--fire-glow-opencode-3': 'rgba(255, 255, 255, 0.25)',
  '--fire-glow-opencode-4': 'rgba(255, 255, 255, 0.5)',
  '--fire-gradient-claude': 'linear-gradient(90deg, transparent 0%, rgba(204, 120, 92, 0.10) 40%, rgba(204, 120, 92, 0.22) 100%)',
  '--fire-gradient-opencode': 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.08) 40%, rgba(255, 255, 255, 0.18) 100%)'
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
  '--btn-min-max-hover': 'rgba(0,0,0,0.05)',

  /* AI icon colors - light mode */
  '--ai-claude-color': '#b85a3a',
  '--ai-claude-bg': 'rgba(184,90,58,0.10)',
  '--ai-claude-glow': 'rgba(184,90,58,0.20)',
  '--ai-opencode-color': '#3d4f6e',
  '--ai-opencode-bg': 'rgba(61,79,110,0.08)',
  '--ai-opencode-glow': 'rgba(61,79,110,0.15)',

  /* Fire effect - light mode (darker, more saturated colors for contrast) */
  '--fire-claude': '#b0553a',
  '--fire-opencode': '#3d4f6e',
  '--fire-glow-claude-3': 'rgba(176, 85, 58, 0.30)',
  '--fire-glow-claude-4': 'rgba(176, 85, 58, 0.55)',
  '--fire-glow-opencode-3': 'rgba(61, 79, 110, 0.30)',
  '--fire-glow-opencode-4': 'rgba(61, 79, 110, 0.55)',
  '--fire-gradient-claude': 'linear-gradient(90deg, transparent 0%, rgba(176, 85, 58, 0.10) 40%, rgba(176, 85, 58, 0.20) 100%)',
  '--fire-gradient-opencode': 'linear-gradient(90deg, transparent 0%, rgba(61, 79, 110, 0.08) 40%, rgba(61, 79, 110, 0.18) 100%)'
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
  '--btn-min-max-hover': 'Min/Max Button Hover',

  '--ai-claude-color': 'AI Claude Icon',
  '--ai-claude-bg': 'AI Claude Background',
  '--ai-claude-glow': 'AI Claude Glow',
  '--ai-opencode-color': 'AI OpenCode Icon',
  '--ai-opencode-bg': 'AI OpenCode Background',
  '--ai-opencode-glow': 'AI OpenCode Glow',

  '--fire-claude': 'Fire Claude',
  '--fire-opencode': 'Fire OpenCode',
  '--fire-glow-claude-3': 'Fire Claude Glow (low)',
  '--fire-glow-claude-4': 'Fire Claude Glow (high)',
  '--fire-glow-opencode-3': 'Fire OpenCode Glow (low)',
  '--fire-glow-opencode-4': 'Fire OpenCode Glow (high)',
  '--fire-gradient-claude': 'Fire Claude Gradient',
  '--fire-gradient-opencode': 'Fire OpenCode Gradient'
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
