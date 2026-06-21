export type ShellType = 'powershell' | 'pwsh' | 'cmd' | 'gitbash' | 'wsl'

export interface ShortcutMap {
  newTerminal: string
  closeTerminal: string
  nextTab: string
  prevTab: string
  toggleSidebar: string
  settings: string
}

export interface AppSettings {
  theme: 'dark' | 'light'
  fontFamily: string
  fontSize: number
  cursorStyle: 'block' | 'underline' | 'bar'
  cursorBlink: boolean
  opacity: number
  defaultShell: ShellType
  sidebarPosition: 'left' | 'right'
  shortcuts: ShortcutMap
}
