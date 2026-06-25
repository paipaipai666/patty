export type ShellType = 'powershell' | 'pwsh' | 'cmd' | 'gitbash' | 'wsl'

export interface ShortcutMap {
  newTerminal: string
  closeTerminal: string
  nextTab: string
  prevTab: string
  toggleSidebar: string
  settings: string
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

  '--fire-claude': string
  '--fire-opencode': string
  '--fire-glow-claude-3': string
  '--fire-glow-claude-4': string
  '--fire-glow-opencode-3': string
  '--fire-glow-opencode-4': string
  '--fire-gradient-claude': string
  '--fire-gradient-opencode': string
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
}

export interface AppSettings {
  theme: string
  fontFamily: string
  fontSize: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  opacity: number
  defaultShell: ShellType
  sidebarPosition: 'left' | 'right'
  shortcuts: ShortcutMap
  customThemes: CustomTheme[]
  notifications: NotificationSettings
}
