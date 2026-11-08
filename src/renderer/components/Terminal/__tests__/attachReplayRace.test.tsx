import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { LocalPtyMessage, TerminalAPI } from '../../../api'
import type { TerminalSession } from '../../../store/sessionStore'



interface MockTerm {
  writes: string[]
  consume: Array<() => void>
  disposed: boolean
}

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    static instances: MockTerm[] = []
    cols = 80
    rows = 24
    options: Record<string, unknown> = {}
    unicode = { activeVersion: '11' }
    disposed = false
    writes: string[] = []
    consume: Array<() => void> = []
    constructor() {
      MockTerminal.instances.push(this)
    }
    open(): void {}
    loadAddon(): void {}
    onData(): { dispose(): void } { return { dispose() {} } }
    onKey(): { dispose(): void } { return { dispose() {} } }
    attachCustomKeyEventHandler(): { dispose(): void } { return { dispose() {} } }
    registerOscHandler(): { dispose(): void } { return { dispose() {} } }
    fit(): void {}
    write(data: string, callback?: () => void): void {
      if (this.disposed) throw new Error('write to disposed terminal')
      this.writes.push(data)
      if (callback) this.consume.push(callback)
    }
    hasSelection(): boolean { return false }
    getSelection(): string { return '' }
    dispose(): void { this.disposed = true }
  }
  return { Terminal: MockTerminal }
})

vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} loadAddon(): void {} } }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class { dispose(): void {} } }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { dispose(): void {} clearTextureAtlas(): void {} } }))
vi.mock('@xterm/addon-image', () => ({ ImageAddon: class { dispose(): void {} } }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class { dispose() {} } }))

vi.mock('../../../store/sessionStore', () => {
  const state = {
    sidebarTransitioning: false,
    markAgentRead: vi.fn(),
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
vi.mock('../../../utils/ompFrameObserver', () => ({ registerOmpFrameObserver: () => ({ refresh() {}, dispose() {} }) }))
vi.mock('../../../utils/shellReadiness', () => ({ markTerminalOpen: () => {} }))

import { TerminalPane } from '../TerminalPane'
import { Terminal } from '@xterm/xterm'


const TerminalMock = Terminal as unknown as { instances: MockTerm[] }

const session: TerminalSession = {
  id: 'sess-race',
  title: 'Race',
  color: 'blue',
  cwd: 'C:\\',
  shell: 'powershell',
  pid: 0,
  createdAt: Date.now(),
  collectionId: null
}

                                                               
declare global {

  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

let receive: (message: LocalPtyMessage) => void
const acknowledge = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const StubResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver
  acknowledge.mockClear()

  const terminalAPI = {
    write: vi.fn(),

    openLocalSession: vi.fn((_options, onMessage: (message: LocalPtyMessage) => void) => {
      receive = onMessage
      receive({ kind: 'data', sequence: 1, text: 'PREHEAT-BANNER\r\n' })
      receive({ kind: 'data', sequence: 2, text: 'ATTACH-WINDOW-OUTPUT\r\n' })
      return {
        ready: Promise.resolve({ success: true, pid: 4321 }),
        acknowledge,
        dispose: vi.fn()
      }
    }),
    kill: vi.fn(),
    resize: vi.fn()
  }

  window.terminalAPI = terminalAPI as unknown as TerminalAPI
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TerminalPane local output', () => {
  it('keeps early output in order and acknowledges it only after xterm consumes it', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(<TerminalPane session={session} visible={true} />)
    })


    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    const term = TerminalMock.instances.at(-1)!
    expect(term.writes).toEqual(['PREHEAT-BANNER\r\n'])
    act(() => receive({ kind: 'data', sequence: 3, text: '\x1b]1337;File=' }))
    expect(acknowledge).not.toHaveBeenCalled()
    act(() => term.consume.shift()?.())
    expect(acknowledge.mock.calls).toEqual([[1]])
    expect(term.writes).toEqual(['PREHEAT-BANNER\r\n', 'ATTACH-WINDOW-OUTPUT\r\n'])
    act(() => term.consume.shift()?.())
    expect(acknowledge.mock.calls).toEqual([[1], [2]])
    act(() => term.consume.shift()?.())
    expect(acknowledge.mock.calls).toEqual([[1], [2], [3]])
    act(() => receive({ kind: 'exit', code: 7 }))
    expect(term.writes.at(-1)).toContain('[Process exited]')

    act(() => root.unmount())
  })
})
