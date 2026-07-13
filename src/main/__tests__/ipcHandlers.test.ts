import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const handlers: Record<string, (...a: any[]) => any> = {}
  const listeners: Record<string, (...a: any[]) => any> = {}
  const send = vi.fn()
  const loadSettings = vi.fn(() => ({
    notifications: { claudeCode: true, openCode: true, codex: true }
  }))
  const saveSettings = vi.fn()
  const saveState = vi.fn()
  const exitHandlers: Record<string, Record<string, Function[]>> = {}
  return { handlers, listeners, send, loadSettings, saveSettings, saveState, exitHandlers }
})

// Use the REAL ptyManager so both exit callbacks (ptyManager's term.onExit and
// ipcHandlers' term.onExit) actually register and fire.
vi.mock('node-pty', () => ({
  spawn: vi.fn((_: string, __: string[], opts: any) => {
    const id = (opts?.env as any)?.["PATTY_PANE_ID"] ?? "unknown"
    const handlers: Record<string, Function[]> = {}
    h.exitHandlers[id] = handlers
    return {
      on: vi.fn((e: string, cb: Function) => { (handlers[e] ||= []).push(cb) }),
      onData: vi.fn(() => ({ dispose() {} })),
      onExit: vi.fn((cb: Function) => { (handlers["exit"] ||= []).push(cb); return { dispose() {} } }),
      kill: vi.fn(),
      write: vi.fn(),
      resize: vi.fn()
    }
  })
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (c: string, f: (...a: any[]) => any) => { h.handlers[c] = f },
    on: (c: string, f: (...a: any[]) => any) => { h.listeners[c] = f }
  },
  BrowserWindow: { getAllWindows: vi.fn(() => [{ isDestroyed: () => false, webContents: { send: h.send } }]) },
  app: { isPackaged: false, getAppPath: () => '/app' },
  dialog: { showOpenDialog: vi.fn() }
}))

vi.mock('child_process', () => ({ execSync: vi.fn(() => '') }))
vi.mock('../heartbeat', () => ({ removePane: vi.fn() }))
vi.mock('../settingsHandler', () => ({ loadSettings: h.loadSettings, saveSettings: h.saveSettings }))
vi.mock('../stateHandler', () => ({ loadState: vi.fn(() => ({})), saveState: h.saveState }))

import { registerIpcHandlers } from '../ipcHandlers'

const fakeWin = { webContents: { send: h.send } } as any
const fakeMetrics = { history: () => [], recordFirstTerminal: vi.fn(), dump: () => ({}) } as any

beforeEach(() => {
  for (const k of Object.keys(h.handlers)) delete h.handlers[k]
  for (const k of Object.keys(h.listeners)) delete h.listeners[k]
  h.send.mockClear()
  h.loadSettings.mockClear()
  h.saveSettings.mockClear()
  h.saveState.mockClear()
  for (const k of Object.keys(h.exitHandlers)) delete h.exitHandlers[k]
  registerIpcHandlers(() => fakeWin, fakeMetrics)
})

describe('ipcHandlers validation (M7)', () => {
  it('rejects an unknown settings key instead of writing it verbatim', () => {
    expect(() => h.handlers['settings:set']({}, 'totallyUnknownKey', 123)).toThrow()
  })

  it('rejects a malformed persisted state payload', () => {
    expect(() => h.listeners['state:save']({}, 'not-an-object')).toThrow()
  })
})

describe('pty:create single exit notification (double onExit)', () => {
  it('produces exactly one exit notification, not two', () => {
    h.handlers['pty:create']({}, 'pane-double', 'C:\\', 'powershell', 80, 24)
    const exits = h.exitHandlers['pane-double']?.['exit'] || []
    exits.forEach((cb: Function) => cb({ exitCode: 0 }))
    const exitSends = h.send.mock.calls.filter(([chan]) => String(chan).startsWith('pty:exit'))
    // DESIRED: one exit → one notification. Currently ptyManager AND ipcHandlers
    // each register an onExit, so two notifications are sent — this fails.
    expect(exitSends).toHaveLength(1)
  })
})
