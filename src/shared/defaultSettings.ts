import type { AppSettings } from './settingsTypes'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  windowMaterial: 'auto',
  fontFamily: 'Cascadia Code',
  fontSize: 14,
  cursorStyle: 'bar',
  cursorBlink: true,
  opacity: 1.0,
  scrollback: 5000,
  defaultShell: 'powershell',
  sidebarPosition: 'left',
  shortcuts: {
    commandPalette: 'Ctrl+Shift+P',
    newTerminal: 'Ctrl+T',
    closeTerminal: 'Ctrl+W',
    nextTab: 'Ctrl+]',
    prevTab: 'Ctrl+[',
    toggleSidebar: 'Ctrl+B',
    settings: 'Ctrl+,',
    splitHorizontal: 'Ctrl+Shift+D',
    splitVertical: 'Ctrl+Shift+E',
    closePane: 'Ctrl+Shift+W',
    turnDirectory: 'Ctrl+Shift+J',
    previousTurn: 'Ctrl+Shift+PageUp',
    nextTurn: 'Ctrl+Shift+PageDown',
    returnToLive: 'Ctrl+Shift+End'
  },
  customThemes: [],
  desktopNotifications: true,
  notifications: {
    claudeCode: true,
    openCode: true,
    codex: true,
    ohMyPi: true,
    qwenCode: true,
    copilotCli: true
  },
  sshProfiles: []
}
