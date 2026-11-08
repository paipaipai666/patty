import type { ShortcutMap } from '../../shared/settingsTypes'
import { APPLICATION_SHORTCUT_DEFINITIONS } from './shortcuts'

export type CommandFocus = 'terminal' | 'focused-terminal' | 'previous' | 'dialog'

export interface AppCommand {
  id: string
  label: string
  group: string
  description: string
  keywords?: string
  shortcut?: string
  disabledReason?: () => string | undefined
  allowInEditable?: boolean
  run: (origin: Element | null) => CommandFocus | Promise<CommandFocus>
}

type ShortcutActions = Record<(typeof APPLICATION_SHORTCUT_DEFINITIONS)[number]['key'], () => void>

export function createShortcutCommands(shortcuts: ShortcutMap, actions: ShortcutActions): AppCommand[] {
  return APPLICATION_SHORTCUT_DEFINITIONS.map(({ key, label }) => {
    return {
      id: key, label, group: 'Actions', description: key === 'newTerminal' ? 'New workspace'
        : key === 'nextTab' || key === 'prevTab' ? 'All sessions'
          : key === 'settings' || key === 'toggleSidebar' || key === 'commandPalette' ? 'Application' : 'Current pane',
      shortcut: shortcuts[key],
      allowInEditable: key === 'commandPalette',
      run: origin => {
        if ((key === 'settings' || key === 'commandPalette') && origin instanceof HTMLElement && origin.isConnected) origin.focus()
        actions[key]()
        return key === 'settings' || key === 'commandPalette' ? 'dialog' : key === 'toggleSidebar' ? 'previous' : 'terminal'
      }
    }
  })
}
