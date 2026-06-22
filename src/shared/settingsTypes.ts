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
  '--bg-titlebar': string
  '--bg-sidebar': string
  '--bg-main': string
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
  '--btn-close-hover': string
  '--btn-min-max-hover': string
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
