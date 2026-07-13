import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

// xterm mocks
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

// Use the REAL settings store so changing a setting triggers a real re-render.
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
vi.mock('../../../styles/themes', () => ({ getThemeColors: () => ({ terminal: {} }) }))
vi.mock('../../../utils/osc7Handler', () => ({ registerOsc7Handler: () => ({ dispose() {} }) }))
vi.mock('../../../utils/shellReadiness', () => ({ markTerminalOpen: () => {} }))

import { TerminalPane } from '../TerminalPane'
import { useSettingsStore } from '../../../store/settingsStore'

const terminalAPI = {
  write: vi.fn(),
  createSession: vi.fn().mockResolvedValue({ success: true, pid: 1234 }),
  onData: vi.fn(() => () => {}),
  onExit: vi.fn(() => () => {}),
  kill: vi.fn(),
  resize: vi.fn()
}

const session = { id: 'sess-m4', cwd: 'C:\\', shell: 'powershell.exe' } as any

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  terminalAPI.write.mockClear()
  terminalAPI.createSession.mockClear()
  terminalAPI.onData.mockClear()
  terminalAPI.onExit.mockClear()
  terminalAPI.kill.mockClear()
  terminalAPI.resize.mockClear()
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

describe('TerminalPane settings reactivity (M4)', () => {
  it('does not re-fit panes when a non-layout setting changes', async () => {
    const a = render()
    const b = render()
    // Let both panes finish their initial mount fits.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const before = terminalAPI.resize.mock.calls.length

    // Changing only `theme` must NOT trigger a terminal re-fit (it has no
    // effect on columns/rows). Currently every pane re-fits on any settings
    // change, so this fails.
    const settings = useSettingsStore.getState().settings
    act(() => {
      useSettingsStore.setState({ settings: { ...settings, theme: 'light' } })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })

    const delta = terminalAPI.resize.mock.calls.length - before
    expect(delta).toBe(0) // <-- fails on current code (gets 2)

    a.root.unmount()
    b.root.unmount()
  })
})
