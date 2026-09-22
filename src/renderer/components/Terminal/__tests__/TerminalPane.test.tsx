import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'


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
    onData() { return { dispose() {} } }
    onKey() { return { dispose() {} } }
    attachCustomKeyEventHandler() { return { dispose() {} } }
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
    resetAttention: vi.fn(),
    updatePid: vi.fn(),
    updateCwd: vi.fn(),
    setAttention: vi.fn(),
    setAiType: vi.fn()
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
vi.mock('../../../utils/shellReadiness', () => ({ markTerminalOpen: () => {} }))

import { TerminalPane } from '../TerminalPane'
import { useSessionStore } from '../../../store/sessionStore'


let lastOnExit: (() => void) | undefined

const terminalAPI = {
  write: vi.fn(),
  createSession: vi.fn().mockResolvedValue({ success: true, pid: 1234 }),
  onData: vi.fn(() => ({ ready: Promise.resolve(), unsubscribe: () => {} })),
  onExit: vi.fn((_id: string, cb: () => void) => {
    lastOnExit = cb
    return { ready: Promise.resolve(), unsubscribe: () => {} }
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
  for (const fn of [terminalAPI.write, terminalAPI.createSession, terminalAPI.onData, terminalAPI.onExit, terminalAPI.kill, terminalAPI.resize]) {
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
  it('does not spawn an orphaned PTY or reattach to a disposed terminal after unmount-during-retry', async () => {
    const { root } = render()


    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(terminalAPI.createSession).toHaveBeenCalledTimes(1)


    act(() => {
      lastOnExit!()
    })


    act(() => {
      root.unmount()
    })

    expect(terminalAPI.createSession).toHaveBeenCalledTimes(1)
    expect(terminalAPI.kill).toHaveBeenCalledTimes(1)


    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })


    expect(terminalAPI.createSession).toHaveBeenCalledTimes(1)
    expect(terminalAPI.onData).toHaveBeenCalledTimes(1)
  })
})

describe('TerminalPane async create (SSH StrictMode race)', () => {
  it('ignores a createSession result that resolves after unmount', async () => {
    const { useToastStore } = await import('../../../store/toastStore')
    const { useSessionStore } = await import('../../../store/sessionStore')
    useToastStore.setState({ toasts: [] })
    ;(useSessionStore.getState().updatePid as ReturnType<typeof vi.fn>).mockClear()

    type CreateResult = { success: boolean; pid: number; error?: string }
    let resolveCreate: (value: CreateResult) => void = () => {}
    terminalAPI.createSession.mockImplementationOnce(
      () => new Promise<CreateResult>((resolve) => { resolveCreate = resolve })
    )
    const { root } = render()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(terminalAPI.createSession).toHaveBeenCalledTimes(1)


    act(() => { root.unmount() })
    expect(terminalAPI.kill).toHaveBeenCalledTimes(1)


    await act(async () => {
      resolveCreate({ success: false, pid: 0, error: 'cancelled' })
      await Promise.resolve()
    })
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(useSessionStore.getState().updatePid).not.toHaveBeenCalled()

    expect(terminalAPI.onData).toHaveBeenCalledTimes(1)
    expect(terminalAPI.onExit).toHaveBeenCalledTimes(1)
  })

  it('writes the backend error into the terminal on create failure', async () => {
    const { Terminal } = await import('@xterm/xterm')
    const instances = (Terminal as unknown as { instances: Array<{ writes: string[] }> }).instances
    const before = instances.length
    const { useToastStore } = await import('../../../store/toastStore')
    useToastStore.setState({ toasts: [] })
    terminalAPI.createSession.mockResolvedValueOnce({
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

  it('clears attention and aiType when the PTY exits', async () => {

    render()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => {
      lastOnExit!()
    })
    expect(useSessionStore.getState().setAttention).toHaveBeenCalledWith('sess-c5', null)
    expect(useSessionStore.getState().setAiType).toHaveBeenCalledWith('sess-c5', null)
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
