import { invoke } from '@tauri-apps/api/core'
import { useSessionStore } from '../store/sessionStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useSettingsStore } from '../store/settingsStore'
import { selectSession, closeSession } from '../store/sessionLifecycle'
import { focusActiveTerminal } from '../commands/useApplicationKeyboard'

type Request = { sequence: number } & (
  | { action: 'snapshot' | 'openSettings' | 'cleanup' | 'closeApp' }
  | { action: 'select' | 'notify' | 'remove'; sessionId: string }
)

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
const trace: object[] = []
const record = (event: object) => { trace.push({ at: performance.now(), ...event }); if (trace.length > 80) trace.shift() }
document.addEventListener('focusin', event => {
  const target = event.target
  if (target instanceof HTMLElement) record({ kind: 'focus', tag: target.tagName, pane: target.closest('[data-pane-id]')?.getAttribute('data-pane-id') ?? null })
}, true)
useSessionStore.subscribe((next, previous) => {
  if (next.activeSessionId !== previous.activeSessionId) record({ kind: 'selection', from: previous.activeSessionId, to: next.activeSessionId, activePane: document.activeElement?.closest('[data-pane-id]')?.getAttribute('data-pane-id') ?? null })
})
const write = window.terminalAPI.write
window.terminalAPI.write = (id, data) => { record({ kind: 'input', id, text: data.slice(0,80) }); write(id, data) }

async function until(label: string, check: () => boolean) {
  const deadline = performance.now() + 15_000
  while (!check()) {
    if (performance.now() >= deadline) throw new Error(`Timed out: ${label}`)
    await delay(25)
  }
}

function snapshot() {
  const sessions = useSessionStore.getState()
  const workspaces = useWorkspaceStore.getState()
  const workspace = workspaces.workspaces.find(item => item.id === workspaces.activeWorkspaceId)
  return {
    activeSessionId: sessions.activeSessionId,
    activeWorkspaceId: workspaces.activeWorkspaceId,
    focusedPaneId: workspace?.focusedPaneId ?? null,
    actualFocusPaneId: document.activeElement?.closest('[data-pane-id]')?.getAttribute('data-pane-id') ?? null,
    terminalFocused: document.activeElement?.classList.contains('xterm-helper-textarea') === true,
    settingsOpen: useSettingsStore.getState().settingsOpen,
    text: document.body.innerText.slice(-4000),
    trace,
  }
}

async function execute(request: Request) {
  switch (request.action) {
    case 'snapshot': return {}
    case 'select':
      selectSession(request.sessionId)
      await until('selected terminal', () => {
        const workspace = useWorkspaceStore.getState().workspaces.find(item => item.id === useWorkspaceStore.getState().activeWorkspaceId)
        return Boolean(workspace && document.querySelector(`[data-pane-id="${workspace.focusedPaneId}"] .xterm-helper-textarea`))
      })
      focusActiveTerminal()
      return {}
    case 'notify':
      selectSession(request.sessionId)
      await until('native terminal process', () => (useSessionStore.getState().sessions.find(item => item.id === request.sessionId)?.pid ?? 0) > 0)
      return { notificationSent: await window.terminalAPI.testDesktopNotification(request.sessionId) }
    case 'remove': closeSession(request.sessionId); return {}
    case 'openSettings': useSettingsStore.getState().openSettings(); return {}
    case 'cleanup': await invoke('native_verification_cleanup'); return {}
    case 'closeApp': return {}
  }
}

export async function run() {
  await until('application state', () => useSessionStore.getState().loaded && useSettingsStore.getState().loaded && useWorkspaceStore.getState().workspaces.length > 0)
  let completed = 0
  while (true) {
    const request = await invoke<Request | null>('native_verification_exchange', { report: null })
    if (request && request.sequence > completed) {
      const result = await execute(request).catch((error: unknown) => ({ error: String(error) }))
      await delay(50)
      await invoke('native_verification_exchange', { report: { sequence: request.sequence, action: request.action, ...snapshot(), ...result } })
      completed = request.sequence
      if (request.action === 'closeApp') { window.terminalAPI.windowClose(); return }
    }
    await delay(80)
  }
}
