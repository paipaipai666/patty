import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import type { TerminalSession } from '../../../store/sessionStore'

const { overlayCalls } = vi.hoisted(() => ({
  overlayCalls: [] as Array<{
    items: Array<Record<string, unknown>>
    cell: { widthPx: number; heightPx: number }
  }>
}))

vi.mock('../IipOverlay', () => ({
  IipOverlay: (props: {
    items: Array<Record<string, unknown>>
    cell: { widthPx: number; heightPx: number }
  }) => {
    overlayCalls.push({ items: props.items, cell: props.cell })
    return null
  }
}))

vi.mock('@xterm/xterm', () => {
  class FakeLine {
    cells: string[] = []
    constructor(cols: number) {
      this.cells = new Array(cols).fill('')
    }
    get length() {
      return this.cells.length
    }
    getCell(x: number) {
      if (x < 0 || x >= this.cells.length) return undefined
      return { getChars: () => this.cells[x], getWidth: () => (this.cells[x] === '' ? 0 : 1) }
    }
    setCell(x: number, chars: string) {
      this.cells[x] = chars
    }
  }

  class MockTerminal {
    static instances: MockTerminal[] = []
    options: Record<string, unknown> = {}
    cols = 80
    rows = 24
    unicode = { activeVersion: '11' }
    _disposed = false
    writes: string[] = []
    renderCallbacks: Array<() => void> = []
    scrollCallbacks: Array<() => void> = []
    viewportY = 0
    cursorX = 0
    cursorY = 0
    lines: FakeLine[] = []
    _core = { _renderService: { dimensions: { css: { cell: { width: 9, height: 18 } } } } }

    constructor() {
      this.lines = Array.from({ length: 24 }, () => new FakeLine(80))
      MockTerminal.instances.push(this)
    }

    get buffer() {
      return { active: this }
    }

    get length() {
      return this.lines.length
    }

    get baseY() {
      return this.lines.length - this.rows
    }

    getLine(index: number) {
      return this.lines[index]
    }

    open() {}
    loadAddon() {}
    onData() {
      return { dispose() {} }
    }
    onKey() {
      return { dispose() {} }
    }
    onRender(cb: () => void) {
      this.renderCallbacks.push(cb)
      return { dispose() {} }
    }
    onScroll(cb: () => void) {
      this.scrollCallbacks.push(cb)
      return { dispose() {} }
    }
    attachCustomKeyEventHandler() {
      return { dispose() {} }
    }
    registerOscHandler() {
      return { dispose() {} }
    }
    fit() {}
    hasSelection() {
      return false
    }
    getSelection() {
      return ''
    }
    dispose() {
      this._disposed = true
    }

    write(data: string, cb?: () => void) {
      if (this._disposed) throw new Error('write to disposed terminal')
      this.writes.push(data)
      let i = 0
      while (i < data.length) {
        const ch = data[i]
        if (ch === '\x1b') {
          i += this.skipEscape(data, i)
          continue
        }
        if (ch === '\r') {
          this.cursorX = 0
          i += 1
          continue
        }
        if (ch === '\n') {
          this.lineFeed()
          i += 1
          continue
        }
        const cp = data.codePointAt(i) as number
        const text = String.fromCodePoint(cp)
        const width = cp > 0xffff ? 2 : 1
        const line = this.lines[this.baseY + this.cursorY]
        line.setCell(this.cursorX, text)
        if (width === 2) line.setCell(this.cursorX + 1, '')
        this.cursorX += width
        if (this.cursorX >= this.cols) this.lineFeed()
        i += text.length
      }
      cb?.()
    }

    private lineFeed() {
      if (this.cursorY >= this.rows - 1) {
        this.lines.push(new FakeLine(this.cols))
        this.viewportY = this.baseY
      } else {
        this.cursorY += 1
      }
      this.cursorX = 0
    }

    private skipEscape(data: string, start: number): number {
      const next = data[start + 1]
      if (next === '[') {
        let i = start + 2
        while (i < data.length && !(data[i] >= '@' && data[i] <= '~')) i += 1
        return i + 1 - start
      }
      if (next === ']') {
        const bel = data.indexOf('\x07', start + 2)
        const st = data.indexOf('\x1b\\', start + 2)
        const end = bel === -1 ? st : st === -1 ? bel : Math.min(bel, st)
        if (end === -1) return data.length - start
        return end + (data[end] === '\x07' ? 1 : 2) - start
      }
      return 2
    }
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

const FALLBACK_CELL = { widthPx: 9, heightPx: 18 }
const PNG_B64 = 'iVBORw0KGgo'
const ERASE_PATTERN = /\x1b\[1X/

interface FakeTerminal {
  writes: string[]
  renderCallbacks: Array<() => void>
  scrollCallbacks: Array<() => void>
  viewportY: number
  _core: { _renderService: { dimensions: { css: { cell: { width: number; height: number } } } } }
}

let onDataCallback: ((data: string) => void) | undefined
let resizeObservers: Array<{ cb: () => void; targets: Array<Element> }> = []

const terminalAPI = {
  write: vi.fn(),
  createSession: vi.fn().mockResolvedValue({ success: true, pid: 1234 }),
  onData: vi.fn((_id: string, cb: (data: string) => void) => {
    onDataCallback = cb
    return { ready: Promise.resolve(), unsubscribe: () => {} }
  }),
  onExit: vi.fn(() => ({ ready: Promise.resolve(), unsubscribe: () => {} })),
  kill: vi.fn(),
  resize: vi.fn()
}

const session = { id: 'sess-iip', cwd: 'C:\\', shell: 'powershell.exe' } as unknown as TerminalSession

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 40
  naturalHeight = 20
  private source = ''
  set src(value: string) {
    this.source = value
    if (value.startsWith('data:image/')) this.onload?.()
    else this.onerror?.()
  }
  get src() {
    return this.source
  }
}

function frame(payload: string): string {
  return `\x1b]1337;File=inline=1;width=1;height=1:${payload}\x07`
}

function latestTerminal(): FakeTerminal {
  const instances = (Terminal as unknown as { instances: FakeTerminal[] }).instances
  return instances[instances.length - 1]
}

function lastOverlayItems(): Array<Record<string, unknown>> {
  return overlayCalls.length === 0 ? [] : overlayCalls[overlayCalls.length - 1].items
}

function lastOverlayCell(): { widthPx: number; heightPx: number } | undefined {
  return overlayCalls.length === 0 ? undefined : overlayCalls[overlayCalls.length - 1].cell
}

const { Terminal } = await import('@xterm/xterm')

async function mount() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<TerminalPane session={session} visible={true} />)
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  return { root, container }
}

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as any).ResizeObserver = class {
    entry: { cb: () => void; targets: Array<Element> }
    constructor(cb: () => void) {
      this.entry = { cb, targets: [] }
      resizeObservers.push(this.entry)
    }
    observe(target: Element) {
      this.entry.targets.push(target)
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('Image', FakeImage)
  onDataCallback = undefined
  resizeObservers = []
  overlayCalls.length = 0
  ;(Terminal as unknown as { instances: FakeTerminal[] }).instances.length = 0
  for (const fn of [terminalAPI.write, terminalAPI.createSession, terminalAPI.onData, terminalAPI.onExit, terminalAPI.kill, terminalAPI.resize]) {
    fn.mockClear()
  }
  ;(window as any).terminalAPI = terminalAPI
  document.body.innerHTML = ''
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('IIP overlay placement against emoji rows', () => {
  it('anchors the image at the cell column when a wide glyph precedes the slot', async () => {
    const { root } = await mount()
    const term = latestTerminal()

    act(() => {
      onDataCallback!(`😀${frame(PNG_B64)}`)
    })

    const items = lastOverlayItems()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ col: 2, bufferY: 0, fromSlot: true, slotRow: 0, slotCol: 2 })
    expect(term.writes.some((w) => w.includes('\x1b]1337'))).toBe(false)

    act(() => root.unmount())
  })
})

describe('IIP slot rollback on decode failure', () => {
  it('erases the planted slot cell and shows no overlay item', async () => {
    const { root } = await mount()
    const term = latestTerminal()

    act(() => {
      onDataCallback!(frame('zzzz'))
    })

    expect(term.writes.filter((w) => ERASE_PATTERN.test(w))).toEqual(['\x1b7\x1b[1;1H\x1b[1X\x1b8'])
    expect(lastOverlayItems()).toHaveLength(0)

    term.viewportY = 5
    act(() => {
      onDataCallback!(frame('qqqq'))
    })
    expect(term.writes.filter((w) => ERASE_PATTERN.test(w))).toHaveLength(1)

    act(() => root.unmount())
  })
})

describe('IIP overlay cell metrics', () => {
  it('adopts remeasured cell metrics after a container resize', async () => {
    const { root } = await mount()
    const term = latestTerminal()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(lastOverlayCell()).toEqual(FALLBACK_CELL)

    const target = resizeObservers[0].targets[0] as HTMLElement
    Object.defineProperty(target, 'clientWidth', { value: 640, configurable: true })
    Object.defineProperty(target, 'clientHeight', { value: 480, configurable: true })
    term._core._renderService.dimensions.css.cell = { width: 11, height: 22 }

    act(() => {
      for (const entry of resizeObservers) entry.cb()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
    })
    expect(lastOverlayCell()).toEqual({ widthPx: 11, heightPx: 22 })

    term._core._renderService.dimensions.css.cell = { width: 0, height: 0 }
    act(() => {
      for (const entry of resizeObservers) entry.cb()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60)
    })
    expect(lastOverlayCell()).toEqual({ widthPx: 11, heightPx: 22 })

    act(() => root.unmount())
  })
})

describe('IIP overlay render ticks', () => {
  it('does not re-render while no inline image is placed', async () => {
    const { root } = await mount()
    const term = latestTerminal()
    expect(term.renderCallbacks.length).toBeGreaterThan(0)

    const before = overlayCalls.length
    act(() => {
      for (let i = 0; i < 5; i++) for (const cb of term.renderCallbacks) cb()
    })
    expect(overlayCalls.length).toBe(before)

    act(() => root.unmount())
  })

  it('re-renders on render ticks once an image is placed', async () => {
    const { root } = await mount()
    const term = latestTerminal()

    act(() => {
      onDataCallback!(frame(PNG_B64))
    })
    expect(lastOverlayItems()).toHaveLength(1)

    const before = overlayCalls.length
    act(() => {
      for (const cb of term.renderCallbacks) cb()
    })
    expect(overlayCalls.length).toBeGreaterThan(before)

    act(() => root.unmount())
  })
})
