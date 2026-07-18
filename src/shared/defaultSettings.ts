import type { AppSettings } from './settingsTypes'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  fontFamily: 'Cascadia Code',
  fontSize: 14,
  cursorStyle: 'bar',
  cursorBlink: true,
  opacity: 1.0,
  scrollback: 5000,
  defaultShell: 'powershell',
  sidebarPosition: 'left',
  shortcuts: {
    newTerminal: 'Ctrl+T',
    closeTerminal: 'Ctrl+W',
    nextTab: 'Ctrl+]',
    prevTab: 'Ctrl+[',
    toggleSidebar: 'Ctrl+B',
    settings: 'Ctrl+,',
    splitHorizontal: 'Ctrl+Shift+D',
    splitVertical: 'Ctrl+Shift+E',
    closePane: 'Ctrl+Shift+W'
  },
  customThemes: [],
  notifications: {
    claudeCode: true,
    openCode: true,
    codex: true
  }
}
