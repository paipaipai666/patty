import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// ── xterm mocks ──────────────────────────────────────────────────────────
// A fake Terminal that records a `disposed` flag and throws if written to
// after dispose — so we can detect the "writes to a disposed terminal" half of
// the C5 bug, not just the orphaned-PTY half.
vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    options: Record<string, unknown> = {}
    cols = 80
    rows = 24
    unicode = { activeVersion: '11' }
    _disposed = false
    writes: string[] = []
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

// ── store / util mocks (isolate TerminalPane logic + window.terminalAPI) ──
vi.mock('../../../store/sessionStore', () => {
  const state = {
    sidebarTransitioning: false,
    resetAttention: vi.fn(),
    updatePid: vi.fn(),
    updateCwd: vi.fn()
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

// Captures the callbacks TerminalPane registers with the main process.
let lastOnExit: (() => void) | undefined

const terminalAPI = {
  write: vi.fn(),
  createSession: vi.fn().mockResolvedValue({ success: true, pid: 1234 }),
  onData: vi.fn(() => () => {}),
  onExit: vi.fn((_id: string, cb: () => void) => {
    lastOnExit = cb
    return () => {}
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

    // init timer (50ms) fires → fit + startPty → createSession #1 resolves.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(terminalAPI.createSession).toHaveBeenCalledTimes(1)

    // The shell process exits → TerminalPane schedules a 500ms auto-restart.
    act(() => {
      lastOnExit!()
    })

    // The pane unmounts before the 500ms retry fires.
    act(() => {
      root.unmount()
    })
    // Pre-condition: only the mount spawn happened, and the PTY was killed.
    expect(terminalAPI.createSession).toHaveBeenCalledTimes(1)
    expect(terminalAPI.kill).toHaveBeenCalledTimes(1)

    // The 500ms retry fires after unmount — this is the leak.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    // DESIRED behavior: the pending retry timer must have been cleared on
    // unmount, so no second PTY is spawned and no terminal I/O is reattached
    // to the now-disposed xterm instance.
    expect(terminalAPI.createSession).toHaveBeenCalledTimes(1) // <-- fails on current code (gets 2)
    expect(terminalAPI.onData).toHaveBeenCalledTimes(1) // <-- fails on current code (gets 2)
  })
})

describe('TerminalPane WebGL context loss (M1)', () => {
  it('registers a context-loss handler so the WebGL addon can be re-created', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    // Listeners attach to the inner xterm container, not the test root, so spy
    // on the prototype to capture every addEventListener call during mount.
    const addSpy = vi.spyOn(Element.prototype, 'addEventListener')
    const root = createRoot(container)
    act(() => {
      root.render(<TerminalPane session={session} visible={true} />)
    })
    const events = addSpy.mock.calls.map((c) => String(c[0]))
    addSpy.mockRestore()
    // DESIRED: a context-loss listener exists so a lost WebGL context is
    // recovered. Currently only 'paste' / composition listeners are added,
    // so this fails.
    expect(events.some((e) => /contextlost/i.test(e))).toBe(true)
    act(() => root.unmount())
  })
})
