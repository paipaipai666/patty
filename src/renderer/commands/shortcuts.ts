import type { ShortcutMap } from '../../shared/settingsTypes'

export const TERMINAL_EDITING_SHORTCUTS = ['ctrl+c', 'ctrl+v', 'ctrl+shift+c', 'ctrl+shift+v']

export const SHORTCUT_DEFINITIONS: { key: keyof ShortcutMap; label: string }[] = [
  { key: 'newTerminal', label: 'New terminal' },
  { key: 'closeTerminal', label: 'Close terminal' },
  { key: 'nextTab', label: 'Next session' },
  { key: 'prevTab', label: 'Previous session' },
  { key: 'toggleSidebar', label: 'Toggle sidebar' },
  { key: 'settings', label: 'Open settings' },
  { key: 'splitHorizontal', label: 'Split horizontally' },
  { key: 'splitVertical', label: 'Split vertically' },
  { key: 'closePane', label: 'Close pane' },
  { key: 'commandPalette', label: 'Open command palette' }
]

export function formatShortcut(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) {
    parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key)
  }
  return parts.join('+')
}

export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut.toLowerCase().split('+')
  const modifiers = ['ctrl', 'alt', 'shift', 'meta'].filter(key => parts.includes(key))
  const key = parts.filter(part => !modifiers.includes(part)).join('+')
  return [...modifiers, key].join('+')
}

export function isComposingKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229 || event.getModifierState('AltGraph')
}
