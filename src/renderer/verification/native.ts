import { invoke } from '@tauri-apps/api/core'
import { useSessionStore } from '../store/sessionStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { useSettingsStore } from '../store/settingsStore'
import { selectSession, closeSession } from '../store/sessionLifecycle'
import { focusActiveTerminal } from '../commands/useApplicationKeyboard'
import { noticeSessions } from '../components/Sidebar/sessionQuery'

type ProgramSample = 'blocked' | 'working' | 'done' | 'error' | 'clear' | 'prompt' | 'invalid' | 'reset'
type Request = { sequence: number } & (
  | { action: 'snapshot' | 'openSettings' | 'openDetails' | 'nextAttention' | 'closePanel' | 'minimize' | 'cleanup' | 'closeApp' }
  | { action: 'select' | 'notify' | 'remove'; sessionId: string }
  | { action: 'program'; sessionId: string; report: ProgramSample }
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
    programs: sessions.programStates,
    notices: noticeSessions(sessions.sessions, sessions.agentStates, 'all', sessions.programStates).map(session => session.id),
    text: document.body.innerText.slice(-4000),
    trace,
  }
}

const programSamples: Record<ProgramSample, string> = {
  blocked: "]7501;state=blocked:kind=permission:app=deploy:title=RGVwbG95IHByZXZpZXc=:msg=QXBwcm92ZSBkZXBsb3ltZW50:progress=60",
  working: ']7501;state=working:app=deploy:progress=70',
  done: ']7501;state=done:app=deploy',
  error: ']7501;state=error:app=deploy',
  clear: ']7501;state=clear',
  prompt: ']133;A',
  invalid: ']7501;state=blocked:msg=Cg==',
  reset: 'c',
}

async function paletteCommand(label: string) {
  document.querySelector<HTMLButtonElement>('[aria-label="Open command palette"]')?.click()
  await until('command palette', () => Boolean(document.querySelector('[role="combobox"]')))
  const input = document.querySelector<HTMLInputElement>('[role="combobox"]')
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!input || !setter) throw new Error('Missing command palette input')
  setter.call(input, label)
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await until('matching command', () => Array.from(document.querySelectorAll('[role="option"]')).some(option => option.textContent?.includes(label)))
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
}

async function execute(request: Request) {
  switch (request.action) {
    case 'snapshot': return {}
    case 'program': {
      if (!['target', 'sibling', 'other'].includes(request.sessionId)) throw new Error('Not an isolated fixture terminal')
      await until('program fixture process', () => (useSessionStore.getState().sessions.find(session => session.id === request.sessionId)?.pid ?? 0) > 0)
      const samples = [programSamples[request.report]]
      if (request.report === 'invalid') samples.push(']7501;state=idle:id=validation')
      const script = samples.map(output => `[Console]::Write([string][char]27+'${output}'+[char]7)`).join('; ')
      window.terminalAPI.write(request.sessionId, `powershell.exe -NoLogo -NoProfile -Command "${script}"\r`)
      return {}
    }
    case 'openDetails': await paletteCommand('Show session details'); return {}
    case 'nextAttention': await paletteCommand('Next session needing attention'); return {}
    case 'closePanel':
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      return {}
    case 'minimize': window.terminalAPI.windowMinimize(); return {}
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
