import { expect, test } from 'bun:test'
import { TUI } from '@oh-my-pi/pi-tui/tui'
import { SessionManager } from '@oh-my-pi/pi-coding-agent/session/session-manager'
import PattyNotifier from '../../resources/omp-patty-hook'
import { FixtureTerminal } from './fixture-terminal'

function install() {
  process.env.PATTY_PORT = '1'
  process.env.PATTY_PANE_ID = 'pane-1'
  process.env.PATTY_HOOK_SECRET = 'secret-1'
  const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>()
  PattyNotifier({ on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => { handlers.set(event, handler) } })
  return handlers
}

function clearInstallEnvironment(): void {
  delete process.env.PATTY_PORT
  delete process.env.PATTY_PANE_ID
  delete process.env.PATTY_HOOK_SECRET
}

test('standard branch builds a live bridge and registers, without a transcript', async () => {
  const manager = SessionManager.inMemory('D:/hook-standard')
  manager.appendMessage({ role: 'user', content: 'HOOK_STANDARD_QUESTION', timestamp: 1 })
  const terminal = new FixtureTerminal()
  const ui = new TUI(terminal)
  ui.start()
  const paths: string[] = []
  const pollResolvers: Array<() => void> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    paths.push(url)
    if (url.endsWith('/omp/register')) return new Response(JSON.stringify({ leaseToken: 'lease-1' }))
    if (url.endsWith('/omp/poll')) return await new Promise<Response>(resolve => { pollResolvers.push(() => resolve(new Response('{"command":null}'))) })
    return new Response('{}')
  }) as typeof fetch
  const setWidget = (_key: string, factory: ((tui: TUI) => unknown) | undefined) => {
    if (typeof factory === 'function') factory(ui)
  }
  const handlers = install()
  const ctx = { setInterval() {}, hasUI: true, cwd: 'D:/hook-standard', ui: { setWidget }, sessionManager: manager }
  const leaf = manager.getLeafId()
  try {
    await handlers.get('session_start')?.({}, ctx)
    for (let index = 0; index < 200 && !paths.some(path => path.endsWith('/omp/register')); index++) await Bun.sleep(5)
    expect(paths.some(path => path.endsWith('/omp/register'))).toBe(true)
    expect(manager.getLeafId()).toBe(leaf)
  } finally {
    await handlers.get('session_shutdown')?.({}, ctx)
    for (const resolve of pollResolvers.splice(0)) resolve()
    globalThis.fetch = originalFetch
    ui.stop()
    clearInstallEnvironment()
  }
})

test('no transcript and no TUI does not throw and never registers', async () => {
  const calls: Array<[string, string]> = []
  const originalFetch = globalThis.fetch
  let registered = false
  globalThis.fetch = (async (input: string | URL | Request) => {
    if (String(input).endsWith('/omp/register')) registered = true
    return new Response('{}')
  }) as typeof fetch
  const handlers = install()
  const ctx = {
    setInterval() {}, hasUI: true, cwd: 'D:/hook-standard',
    ui: { setWidget: (key: string, factory: ((tui: TUI) => unknown) | undefined) => { calls.push([key, typeof factory]) } },
    sessionManager: { getSessionId: () => 'standard-session', getLeafId: () => null, getBranchView: () => [] },
  }
  try {
    await handlers.get('session_start')?.({}, ctx)
    expect(calls).toEqual([['patty-navigation', 'function'], ['patty-navigation', 'undefined']])
    expect(registered).toBe(false)
  } finally {
    globalThis.fetch = originalFetch
    clearInstallEnvironment()
  }
})
