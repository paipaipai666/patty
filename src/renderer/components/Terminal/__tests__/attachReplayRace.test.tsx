import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { TerminalAPI } from '../../../api'
import type { TerminalSession } from '../../../store/sessionStore'

// REVIEW.md P0-1 — preheat attach/replay race.
//
// pty.rs create() flips `attached=true` *inside* the create_pty command; from
// that moment the reader thread emits `pty:data:{id}` events instead of
// buffering. TerminalPane only registers its onData listener in the
// createSession().then() callback — after the promise resolves — and Tauri
// drops events that have no listener. Output produced by a preheated shell in
// that window (e.g. a fast prompt redraw, a hooked rc script) is lost: not in
// the replay buffer (attach already happened), not in xterm (no listener yet).
//
// This test models the backend flipping attached mid-create: the mock emits
// terminal data *synchronously inside createSession*, i.e. after the attach
// flip but before the renderer could possibly have subscribed. A correct
// TerminalPane must still deliver that data to xterm (e.g. by subscribing
// before invoking create_pty).

interface MockTerm {
  writes: string[]
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
    write(data: string): void {
      if (this.disposed) throw new Error('write to disposed terminal')
      this.writes.push(data)
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
import { Terminal } from '@xterm/xterm'

// Terminal here is the vi.mock'd MockTerminal class above, which records writes.
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

/** Subset of TerminalAPI TerminalPane touches during mount. */
declare global {
  // React act() environment flag, same as the neighboring test suites set via
  // (globalThis as any) — declared here so the assignment stays typechecked.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

interface MockTerminalAPI {
  write: Mock
  createSession: Mock
  onData: Mock
  onExit: Mock
  kill: Mock
  resize: Mock
}

let dataListeners: Record<string, ((data: string) => void) | undefined>
let droppedData: string[]
let terminalAPI: MockTerminalAPI

function terminalWrites(): string {
  return TerminalMock.instances.map((t) => t.writes.join('')).join('')
}

beforeEach(() => {
  vi.useFakeTimers()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // jsdom has no ResizeObserver; TerminalPane only needs the no-op surface.
  const StubResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver as unknown as typeof ResizeObserver
  dataListeners = {}
  droppedData = []

  terminalAPI = {
    write: vi.fn(),
    // The backend attaches inside create_pty; from then on output is emitted
    // as pty:data events. Emit synchronously here — before the pane's .then()
    // has run — to reproduce the attach/subscribe window. An emit with no
    // registered listener is dropped, mirroring Tauri semantics.
    createSession: vi.fn((id: string) => {
      const cb = dataListeners[id]
      if (cb) {
        cb('ATTACH-WINDOW-OUTPUT\r\n')
      } else {
        droppedData.push('ATTACH-WINDOW-OUTPUT')
      }
      return Promise.resolve({ success: true, pid: 4321, replay: 'PREHEAT-BANNER\r\n' })
    }),
    onData: vi.fn((id: string, cb: (data: string) => void) => {
      dataListeners[id] = cb
      return {
        ready: Promise.resolve(),
        unsubscribe: () => {
          dataListeners[id] = undefined
        }
      }
    }),
    onExit: vi.fn(() => ({ ready: Promise.resolve(), unsubscribe: () => {} })),
    kill: vi.fn(),
    resize: vi.fn()
  }
  // The mock only implements the mount-time surface; the cast is the
  // sanctioned test-double boundary (same pattern as the neighboring suites).
  window.terminalAPI = terminalAPI as unknown as TerminalAPI
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
})

describe('TerminalPane preheat attach race (REVIEW P0-1)', () => {
  it('delivers output produced between backend attach and renderer subscribe', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
      root.render(<TerminalPane session={session} visible={true} />)
    })

    // init timer (50ms) fires → startPty → createSession resolves.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(terminalAPI.createSession).toHaveBeenCalledTimes(1)

    // Control: the replay path works, proving the harness is wired correctly.
    expect(terminalWrites()).toContain('PREHEAT-BANNER')

    // DESIRED: no output may be dropped during session start — the pane must
    // be listening before the backend can emit live data for it.
    // Currently fails: createSession emitted while no onData listener existed,
    // so the attach-window output was dropped and never reached xterm.
    expect(droppedData).toEqual([])
    expect(terminalWrites()).toContain('ATTACH-WINDOW-OUTPUT')

    act(() => root.unmount())
  })
})
