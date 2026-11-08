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

test('standard branch builds a live bridge and registers, without a transcript', async () => {
  const manager = SessionManager.inMemory('D:/hook-standard')
  manager.appendMessage({ role: 'user', content: 'HOOK_STANDARD_QUESTION', timestamp: 1 })
  const terminal = new FixtureTerminal()
  const ui = new TUI(terminal)
  ui.start()
  const paths: string[] = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input)
    paths.push(url)
    if (url.endsWith('/omp/register')) return new Response(JSON.stringify({ leaseToken: 'lease-1' }))
    if (url.endsWith('/omp/poll')) return new Response('{"command":null}')
    return new Response('{}')
  }) as typeof fetch
  const setWidget = (_key: string, factory: ((tui: TUI) => unknown) | undefined) => {
    if (typeof factory === 'function') factory(ui)
  }
  const handlers = install()
  const ctx = { setInterval() {}, hasUI: true, cwd: 'D:/hook-standard', ui: { setWidget }, sessionManager: manager }
  try {
    await handlers.get('session_start')?.({}, ctx)
    for (let i = 0; i < 200 && !paths.some(p => p.endsWith('/omp/register')); i++) await Bun.sleep(5)
    expect(paths.some(p => p.endsWith('/omp/register'))).toBe(true)
    expect(manager.getLeafId()).toBe(manager.getLeafId())
    await handlers.get('session_shutdown')?.({}, ctx)
  } finally {
    globalThis.fetch = originalFetch
    ui.stop()
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
  }
})
