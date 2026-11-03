import type { ShortcutMap } from '../../shared/settingsTypes'
import { SHORTCUT_DEFINITIONS } from './shortcuts'

export type CommandFocus = 'terminal' | 'previous' | 'dialog'

export interface AppCommand {
  id: string
  label: string
  group: string
  description: string
  keywords?: string
  shortcut?: string
  disabledReason?: string
  allowInEditable?: boolean
  run: () => CommandFocus | Promise<CommandFocus>
}

type ShortcutActions = Record<keyof ShortcutMap, () => void>

export function createShortcutCommands(shortcuts: ShortcutMap, actions: ShortcutActions): AppCommand[] {
  return SHORTCUT_DEFINITIONS.map(({ key, label }) => {
    return {
      id: key, label, group: 'Actions', description: key === 'settings' || key === 'toggleSidebar' ? 'Application' : 'Current workspace',
      shortcut: shortcuts[key],
      run: () => {
        actions[key]()
        return key === 'settings' ? 'dialog' : key === 'toggleSidebar' ? 'previous' : 'terminal'
      }
    }
  })
}
