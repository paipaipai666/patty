export type ShellType = 'powershell' | 'pwsh' | 'cmd' | 'gitbash' | 'wsl'

export interface ShortcutMap {
  newTerminal: string
  closeTerminal: string
  nextTab: string
  prevTab: string
  toggleSidebar: string
  settings: string
  splitHorizontal: string
  splitVertical: string
  closePane: string
}

export interface XtermTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface UITheme {
  '--bg-app': string
  '--bg-titlebar': string
  '--bg-sidebar': string
  '--bg-main': string
  '--bg-terminal': string
  '--bg-item-hover': string
  '--bg-item-active': string
  '--bg-statusbar': string
  '--bg-input': string
  '--bg-context-menu': string
  '--text-primary': string
  '--text-secondary': string
  '--text-muted': string
  '--border-subtle': string
  '--border-medium': string
  '--accent': string
  '--accent-alpha': string
  '--accent-glow': string
  '--bg-dropdown-menu': string
  '--btn-close-hover': string
  '--btn-min-max-hover': string

  '--ai-claude-color': string
  '--ai-claude-bg': string
  '--ai-claude-glow': string
  '--ai-opencode-color': string
  '--ai-opencode-bg': string
  '--ai-opencode-glow': string
  '--ai-codex-color': string
  '--ai-codex-bg': string
  '--ai-codex-glow': string

  '--fire-claude': string
  '--fire-opencode': string
  '--fire-codex': string
  '--fire-glow-claude-3': string
  '--fire-glow-claude-4': string
  '--fire-glow-opencode-3': string
  '--fire-glow-opencode-4': string
  '--fire-glow-codex-3': string
  '--fire-glow-codex-4': string
  '--fire-gradient-claude': string
  '--fire-gradient-opencode': string
  '--fire-gradient-codex': string

  '--attention-complete-bg': string
  '--attention-complete-bar': string
  '--attention-complete-glow': string
  '--attention-permission-bg': string
  '--attention-permission-bar': string
  '--attention-permission-glow': string
  '--attention-error-bg': string
  '--attention-error-bar': string
  '--attention-error-glow': string

  '--overlay-bg': string
  '--scrollbar-thumb': string
  '--neutral': string
  '--neutral-4': string
  '--neutral-5': string
  '--neutral-6': string
  '--neutral-8': string
  '--neutral-10': string
  '--neutral-20': string
  '--accent-glow-subtle': string
  '--accent-glow-soft': string
  '--accent-glow-light': string
  '--accent-border': string
  '--accent-glow-strong': string
  '--accent-hover': string
  '--cyan-glow-soft': string
  '--cyan-glow': string
  '--cyan-glow-light': string
  '--cyan-glow-medium': string
  '--green-glow': string
  '--red-glow': string
  '--bg-error': string
  '--btn-close-hover-alpha': string
  '--text-separator': string
  '--btn-close-text': string
  '--btn-active-text': string
  '--surface-highlight': string
  '--green': string
  '--red': string
  '--cyan': string
  '--amber': string

  '--bg-hover': string
  '--bg-tertiary': string
  '--text-tertiary': string
  '--border-light': string
  '--border-strong': string
  '--color-amber': string
  '--color-gray': string
  '--indigo': string
}

export interface CustomTheme {
  id: string
  name: string
  ui: UITheme
  terminal: XtermTheme
}

export interface NotificationSettings {
  claudeCode: boolean
  openCode: boolean
  codex: boolean
}

export interface AppSettings {
  theme: string
  fontFamily: string
  fontSize: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  opacity: number
  scrollback: number
  defaultShell: ShellType
  sidebarPosition: 'left' | 'right'
  shortcuts: ShortcutMap
  customThemes: CustomTheme[]
  notifications: NotificationSettings
}
