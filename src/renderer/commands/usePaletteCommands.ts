import { useSessionStore } from '../store/sessionStore'
import { useSettingsStore } from '../store/settingsStore'
import { getFocusedSessionId, useWorkspaceStore } from '../store/workspaceStore'
import { selectSession, createSshTerminal } from '../store/sessionLifecycle'
import { nextAttentionSessionId } from '../components/Sidebar/sessionQuery'
import { sessionLocation, sessionTool } from '../utils/sessionPresentation'
import { BUILTIN_THEMES } from '../styles/themes'
import type { AppCommand, CommandFocus } from './applicationCommands'
import { SHELL_LABELS } from '../../shared/settingsTypes'

const KEYWORDS: Record<string, string> = {
  newTerminal: 'new shell 新建 终端', closeTerminal: 'terminate 关闭 终端',
  nextTab: 'next tab 下一个 会话', prevTab: 'previous tab 上一个 会话',
  toggleSidebar: 'toggle show hide 侧栏 显示 隐藏', settings: 'preferences 设置',
  splitHorizontal: 'split right 分屏 水平', splitVertical: 'split below 分屏 垂直', closePane: 'hide pane 关闭 分屏'
}

function openSettings(category: string, origin: Element | null): CommandFocus {
  if (origin instanceof HTMLElement && origin.isConnected) origin.focus()
  useSettingsStore.getState().openSettings(category)
  return 'dialog'
}

export function usePaletteCommands(shortcutCommands: AppCommand[], pickFolder: () => Promise<string | undefined>): AppCommand[] {
  const sessions = useSessionStore(state => state.sessions)
  const activeSessionId = useSessionStore(state => state.activeSessionId)
  const sidebarVisible = useSessionStore(state => state.sidebarVisible)
  useSessionStore(state => state.agentStates)
  const settings = useSettingsStore(state => state.settings)
  useWorkspaceStore(state => state.workspaces)
  useWorkspaceStore(state => state.activeWorkspaceId)
  const focusedSessionId = getFocusedSessionId()
  const active = sessions.find(session => session.id === activeSessionId)
  const focused = sessions.find(session => session.id === focusedSessionId)
  const commands = shortcutCommands.map(command => ({
    ...command,
    label: command.id === 'toggleSidebar' ? sidebarVisible ? 'Hide sidebar' : 'Show sidebar' : command.label,
    keywords: KEYWORDS[command.id],
    description: command.id === 'newTerminal' ? `New workspace · ${SHELL_LABELS[settings.defaultShell]}`
      : command.id === 'closeTerminal' ? active ? `End session · ${active.title}` : 'Current session'
        : command.id === 'closePane' ? focused ? `Remove from workspace · ${focused.title}` : 'Current pane'
          : ['splitHorizontal', 'splitVertical'].includes(command.id) ? focused ? `Current pane · ${focused.title}` : 'Current pane' : command.description,
    disabledReason: () => {
      const state = useSessionStore.getState()
      if (['splitHorizontal', 'splitVertical', 'closePane'].includes(command.id) && !state.sessions.some(session => session.id === getFocusedSessionId())) return 'Select a terminal pane first'
      if (command.id === 'closeTerminal' && !state.sessions.some(session => session.id === state.activeSessionId)) return 'No active terminal'
      if (['nextTab', 'prevTab'].includes(command.id) && state.sessions.length < 2) return 'Open another session first'
      return undefined
    }
  }))
  const extra: AppCommand[] = [
    { id: 'new-in-folder', label: 'New terminal in folder…', group: 'Actions', description: 'Choose a project folder', keywords: 'directory 新建 终端 文件夹 目录', run: async () => await pickFolder() ? 'terminal' : 'previous' },
    { id: 'next-attention', label: 'Next session needing attention', group: 'Actions', description: 'Waiting for input or reporting an error', keywords: 'approval waiting 待处理 注意 批准', disabledReason: () => nextAttentionSessionId(useSessionStore.getState()) ? undefined : 'No sessions need attention', run: () => {
      const id = nextAttentionSessionId(useSessionStore.getState())
      if (id) selectSession(id)
      return 'terminal'
    } },
    { id: 'shortcut-settings', label: 'Edit keyboard shortcuts', group: 'Actions', description: 'Settings · Shortcuts', keywords: 'keybindings 快捷键 键盘 设置', run: origin => openSettings('shortcuts', origin) },
    { id: 'ssh-settings', label: 'Manage SSH profiles', group: 'Actions', description: 'Settings · SSH', keywords: 'remote host 远程 连接 主机 配置', run: origin => openSettings('ssh', origin) }
  ]
  const sessionCommands: AppCommand[] = sessions.map(session => ({
    id: `session:${session.id}`, label: `Switch to ${session.title}`, group: 'Sessions',
    description: `${sessionTool(session)} · ${sessionLocation(session)}`,
    keywords: `切换 会话 ${session.cwd} ${session.shell} ${session.ssh?.host ?? ''}`,
    run: () => {
      if (!useSessionStore.getState().sessions.some(item => item.id === session.id)) return 'previous'
      selectSession(session.id)
      return 'terminal'
    }
  }))
  const sshCommands: AppCommand[] = (settings.sshProfiles ?? []).map(profile => ({
    id: `ssh:${profile.id}`, label: `Connect to ${profile.name}`, group: 'SSH', description: `${profile.user}@${profile.host}:${profile.port}`,
    keywords: 'remote 连接 远程 主机', run: () => {
      const current = useSettingsStore.getState().settings.sshProfiles.find(item => item.id === profile.id)
      if (!current) return 'previous'
      createSshTerminal(current)
      return 'terminal'
    }
  }))
  const themes = [...Object.entries(BUILTIN_THEMES).map(([id, theme]) => ({ id, name: theme.name })), ...settings.customThemes]
  const themeCommands = themes.map<AppCommand>(theme => ({
    id: `theme:${theme.id}`, label: `Use ${theme.name} theme`, group: 'Themes',
    description: settings.theme === theme.id ? 'Current theme · Application' : 'Application',
    keywords: `appearance colors 主题 外观 ${theme.id === 'light' ? '浅色' : theme.id === 'dark' ? '深色' : ''}`,
    run: async (): Promise<CommandFocus> => {
      const state = useSettingsStore.getState()
      if (state.settings.theme !== theme.id) await state.updateSetting('theme', theme.id)
      if (useSettingsStore.getState().settings.theme !== theme.id) throw new Error('Theme was not saved')
      return 'previous'
    }
  }))
  return [...commands.filter(command => command.id !== 'commandPalette'), ...extra, ...sessionCommands, ...sshCommands, ...themeCommands]
}
