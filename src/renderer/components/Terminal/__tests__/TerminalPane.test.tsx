import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

const terminalInput = vi.hoisted(() => ({ deliver: (_data: string) => {}, key: (_event: KeyboardEvent): boolean => true }))


vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    static instances: MockTerminal[] = []
    options: Record<string, unknown> = {}
    cols = 80
    rows = 24
    unicode = { activeVersion: '11' }
    _disposed = false
    writes: string[] = []
    constructor() {
      MockTerminal.instances.push(this)
    }
    open() {}
    loadAddon() {}
    onData(callback: (data: string) => void) {
      terminalInput.deliver = callback
      return { dispose() {} }
    }
    onKey() { return { dispose() {} } }
    attachCustomKeyEventHandler(callback: (event: KeyboardEvent) => boolean) { terminalInput.key = callback; return { dispose() {} } }
    registerOscHandler() { return { dispose() {} } }
    fit() {}
    write(data: string) {
      if (this._disposed) throw new Error('write to disposed terminal')
      this.writes.push(data)
    }
    hasSelection() { return false }
    getSelection() { return '' }
    dispose() { this._disposed = true }
  }
  return { Terminal: MockTerminal }
})

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} loadAddon() {} } }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class { dispose() {} } }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { dispose() {} clearTextureAtlas() {} } }))
vi.mock('@xterm/addon-image', () => ({ ImageAddon: class { dispose() {} } }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class { dispose() {} } }))


vi.mock('../../../store/sessionStore', () => {
  const state = {
    sidebarTransitioning: false,
    markAgentRead: vi.fn(),
    updatePid: vi.fn(),
    updateCwd: vi.fn(),

  }
  const useSessionStore = (sel: (s: typeof state) => unknown) => sel(state)
  useSessionStore.getState = () => state
  return { useSessionStore }
})

vi.mock('../../../store/settingsStore', () => {
  const settings = {
    fontFamily: 'Consolas',
    fontSize: 14,
    cursorBlink: true,
    cursorStyle: 'block',
    opacity: 1,
    scrollback: 5000,
    theme: 'dark',
    customThemes: {}
  }
  const state = { settings }
  const useSettingsStore = (sel: (s: typeof state) => unknown) => sel(state)
  return { useSettingsStore }
})

vi.mock('../../../styles/themes', () => ({ getThemeColors: () => ({ terminal: {} }) }))
vi.mock('../../../utils/osc7Handler', () => ({ registerOsc7Handler: () => ({ dispose() {} }) }))
vi.mock('../../../utils/ompFrameObserver', () => ({ registerOmpFrameObserver: () => ({ refresh() {}, dispose() {} }) }))
vi.mock('../../../utils/shellReadiness', () => ({ markTerminalOpen: () => {} }))

import { TerminalPane } from '../TerminalPane'
import { useSessionStore } from '../../../store/sessionStore'
import type { LocalPtyMessage } from '../../../api'


let lastOnExit: (() => void) | undefined
const localReady = vi.fn().mockResolvedValue({ success: true, pid: 1234 })
const disconnect = vi.fn()

const terminalAPI = {
  write: vi.fn(),
  openLocalSession: vi.fn((_options, receive: (message: LocalPtyMessage) => void) => {
    lastOnExit = () => receive({ kind: 'exit', code: 0 })
    return { ready: localReady(), acknowledge: vi.fn(), dispose: disconnect }
  }),
  kill: vi.fn(),
  resize: vi.fn()
}

const session = { id: 'sess-c5', cwd: 'C:\\', shell: 'powershell.exe' } as any

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  lastOnExit = undefined
  for (const fn of [...Object.values(terminalAPI), localReady, disconnect]) {
    fn.mockClear()
  }
  ;(window as any).terminalAPI = terminalAPI
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
})

function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<TerminalPane session={session} visible={true} />)
  })
  return { container, root }
}

describe('TerminalPane PTY lifecycle (C5)', () => {
  it('typing forwards the bytes and marks the notice read without clearing agent state', () => {
    const { root } = render()
    vi.mocked(useSessionStore.getState().markAgentRead).mockClear()
    act(() => { terminalInput.key(new KeyboardEvent('keydown', { key: 'a' })); terminalInput.deliver('answer') })
    expect(terminalAPI.write).toHaveBeenCalledWith('sess-c5', 'answer')
    expect(useSessionStore.getState().markAgentRead).toHaveBeenCalledWith('sess-c5')
    act(() => root.unmount())
  })

  it('terminal protocol replies reach the backend without marking a notice read or selecting the pane', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const used = vi.fn()
    act(() => root.render(<TerminalPane session={session} visible={false} onUsed={used} />))
    vi.mocked(useSessionStore.getState().markAgentRead).mockClear()
    for (const reply of ['\x1b[1;1R', '\x1b[?62;4;9;22c', '\x1b[I', '\x1b[O']) {
      act(() => terminalInput.deliver(reply))
      expect(terminalAPI.write).toHaveBeenLastCalledWith('sess-c5', reply)
    }
    expect(used).not.toHaveBeenCalled()
    expect(useSessionStore.getState().markAgentRead).not.toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('does not spawn an orphaned PTY or reattach to a disposed terminal after unmount-during-retry', async () => {
    const { root } = render()


    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(terminalAPI.openLocalSession).toHaveBeenCalledTimes(1)


    act(() => {
      lastOnExit!()
    })


    act(() => {
      root.unmount()
    })

    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(terminalAPI.kill).not.toHaveBeenCalled()


    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })


    expect(terminalAPI.openLocalSession).toHaveBeenCalledTimes(1)
  })
})

describe('TerminalPane async local attach', () => {
  it('ignores a connection result that resolves after unmount', async () => {
    const { useToastStore } = await import('../../../store/toastStore')
    const { useSessionStore } = await import('../../../store/sessionStore')
    useToastStore.setState({ toasts: [] })
    ;(useSessionStore.getState().updatePid as ReturnType<typeof vi.fn>).mockClear()

    type CreateResult = { success: boolean; pid: number; error?: string }
    let resolveCreate: (value: CreateResult) => void = () => {}
    localReady.mockImplementationOnce(
      () => new Promise<CreateResult>((resolve) => { resolveCreate = resolve })
    )
    const { root } = render()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(terminalAPI.openLocalSession).toHaveBeenCalledTimes(1)


    act(() => { root.unmount() })
    expect(terminalAPI.kill).not.toHaveBeenCalled()


    await act(async () => {
      resolveCreate({ success: false, pid: 0, error: 'cancelled' })
      await Promise.resolve()
    })
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(useSessionStore.getState().updatePid).not.toHaveBeenCalled()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('writes the backend error into the terminal on create failure', async () => {
    const { Terminal } = await import('@xterm/xterm')
    const instances = (Terminal as unknown as { instances: Array<{ writes: string[] }> }).instances
    const before = instances.length
    const { useToastStore } = await import('../../../store/toastStore')
    useToastStore.setState({ toasts: [] })
    localReady.mockResolvedValueOnce({
      success: false,
      pid: 0,
      error: 'auth: Authentication failed'
    })
    render()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    const term = instances[before]
    expect(term.writes.some((w) => w.includes('auth: Authentication failed'))).toBe(true)
    expect(useToastStore.getState().toasts.length).toBeGreaterThan(0)
  })


})

describe('TerminalPane WebGL context loss (M1)', () => {
  it('registers a context-loss handler so the WebGL addon can be re-created', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const addSpy = vi.spyOn(Element.prototype, 'addEventListener')
    const root = createRoot(container)
    act(() => {
      root.render(<TerminalPane session={session} visible={true} />)
    })
    const events = addSpy.mock.calls.map((c) => String(c[0]))
    addSpy.mockRestore()

    expect(events.some((e) => /contextlost/i.test(e))).toBe(true)
    act(() => root.unmount())
  })
})
