import { createRoot } from 'react-dom/client'
import { Sidebar } from '../../src/renderer/components/Sidebar/Sidebar'
import { PaneTreeRoot } from '../../src/renderer/components/Pane/PaneTree'
import { TitleBar } from '../../src/renderer/components/TitleBar/TitleBar'
import { StatusBar } from '../../src/renderer/components/StatusBar/StatusBar'
import { SettingsModal } from '../../src/renderer/components/Settings/SettingsModal'
import { useSessionStore, type TerminalSession } from '../../src/renderer/store/sessionStore'
import { useWorkspaceStore } from '../../src/renderer/store/workspaceStore'
import { useSettingsStore } from '../../src/renderer/store/settingsStore'
import { selectSession, closeSession } from '../../src/renderer/store/sessionLifecycle'
import { DEFAULT_SETTINGS } from '../../src/shared/defaultSettings'
import { applyTheme, getThemeColors } from '../../src/renderer/styles/themes'
import '../../src/renderer/styles/global.css'
import './workbench.css'

const sessions: TerminalSession[] = [
  { id: 'shell', title: 'Development', shell: 'powershell', cwd: 'D:\\code\\terminal\\terminal-sidebar', color: 'blue', collectionId: 'project', pid: 1, createdAt: 1 },
  { id: 'agent', title: 'Fix login callback', shell: 'powershell', cwd: 'D:\\code\\terminal\\terminal-sidebar', color: 'amber', collectionId: 'project', pid: 2, createdAt: 2 },
  { id: 'review', title: 'Review deployment', shell: 'powershell', cwd: 'D:\\code\\deployments', color: 'green', collectionId: null, pid: 3, createdAt: 3 },
  { id: 'remote', title: 'Production logs', shell: 'ssh', cwd: '/srv/payments', ssh: { host: 'prod-01.example.com', user: 'deploy', port: 2222 }, color: 'amber', collectionId: null, pid: 4, createdAt: 4 }
]

const listener = () => ({ ready: Promise.resolve(), unsubscribe: () => {} })
Object.defineProperty(window, 'terminalAPI', { value: {
  onData: listener, onExit: listener, onMaximizeChange: () => () => {},
  createSession: async (id: string) => ({ success: true, pid: 100, replay: id === 'agent'
    ? '\x1b[38;2;224;154;126mClaude Code\x1b[0m\r\n\r\nI found the callback validation issue.\r\n\r\n  npm test -- login-callback\r\n\r\nWaiting for your approval to run the tests.\r\n'
    : id === 'remote' ? 'deploy@prod-01:/srv/payments$ tail -f service.log\r\n09:00:01 INFO  Service ready\r\n09:00:02 INFO  Health check passed\r\n'
    : 'PS D:\\code\\terminal\\terminal-sidebar> git status --short\r\n M src/renderer/components/Sidebar/Sidebar.tsx\r\n M src/renderer/components/Sidebar/Sidebar.module.css\r\n\r\nPS D:\\code\\terminal\\terminal-sidebar> ' }),
  resize: () => {}, write: () => {}, kill: () => {}, stateSave: async () => {}, settingsSet: async () => ({}),
  windowMinimize: () => {}, windowMaximize: () => {}, windowClose: () => {}
} })

useSessionStore.setState({ sessions, collections: [{ id: 'project', name: 'Terminal sidebar', parentId: null, collapsed: false, createdAt: 1 }], activeSessionId: 'shell', sidebarWidth: 264, loaded: true })
useSessionStore.getState().applyAgentUpdate({ paneId: 'agent', revision: 1, agent: { aiType: 'claude', status: 'waiting_approval' } })
useSessionStore.getState().applyAgentUpdate({ paneId: 'review', revision: 2, agent: { aiType: 'codex', status: 'complete' } })
useWorkspaceStore.getState().loadFromPersisted([{
  id: 'main', name: 'Development', collectionId: 'project', focusedPaneId: 'pane-shell',
  paneTree: { id: 'split', type: 'split', direction: 'horizontal', ratio: 0.5, first: { id: 'pane-shell', type: 'leaf', sessionId: 'shell' }, second: { id: 'pane-agent', type: 'leaf', sessionId: 'agent' } }
}], 'main')

function setTheme(theme: 'dark' | 'light') {
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, theme }, loaded: true })
  applyTheme(theme, [])
}
setTheme('dark')
function addCustomTheme() {
  const base = getThemeColors('dark')
  return useSettingsStore.getState().updateSetting('customThemes', [{
    id: 'visual-harbor', name: 'Harbor',
    ui: { ...base.ui, '--bg-app': '#102a33', '--bg-sidebar': '#173c47', '--bg-titlebar': '#13333d', '--accent': '#83c5c1' },
    terminal: { ...base.terminal, background: '#102a33', foreground: '#e1f0f0' }
  }])
}
Object.defineProperty(window, 'workbenchPreview', { value: { setTheme, addCustomTheme, sessions: useSessionStore, workspaces: useWorkspaceStore, settings: useSettingsStore } })

function Workbench() {
  const visible = useSessionStore((state) => state.sidebarVisible)
  const position = useSettingsStore((state) => state.settings.sidebarPosition)
  return <div className="visual-workbench">
    <TitleBar sidebarVisible={visible} onToggleSidebar={() => useSessionStore.getState().toggleSidebar()} />
    <main className="visual-stage" style={{ flexDirection: position === 'right' ? 'row-reverse' : undefined }}>
      {visible && <Sidebar onNewTerminal={() => useSessionStore.getState().addSession()} onNewTerminalPickFolder={() => {}} onNewSsh={() => {}} onSelectSession={selectSession} onCloseSession={closeSession} />}
      <div className="visual-content">
        <div className="visual-panes"><PaneTreeRoot /></div>
        <StatusBar metricsOpen={false} onToggleMetrics={() => {}} />
      </div>
    </main>
    <SettingsModal />
  </div>
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing fixture root')
createRoot(root).render(<Workbench />)
