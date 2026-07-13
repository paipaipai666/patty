import { describe, it, expect, vi, beforeEach } from 'vitest'

const exitHandlers: Record<string, Record<string, Function[]>> = {}
const spawnedPtys: Array<{ kill: Function; write: Function; resize: Function }> = []
const spawnedOpts: Array<Record<string, unknown>> = []

vi.mock('node-pty', () => ({
  spawn: vi.fn((_: string, __: string[], opts: Record<string, unknown>) => {
    spawnedOpts.push(opts)
    const id = (opts?.env as Record<string, string>)?.['PATTY_PANE_ID'] ?? 'unknown'
    const handlers: Record<string, Function[]> = {}
    exitHandlers[id] = handlers
    const term = {
      on: vi.fn((event: string, cb: Function) => {
        handlers[event] = handlers[event] || []
        handlers[event].push(cb)
      }),
      onExit: vi.fn((cb: Function) => {
        handlers['exit'] = handlers['exit'] || []
        handlers['exit'].push(cb)
      }),
      kill: vi.fn(),
      write: vi.fn(),
      resize: vi.fn()
    }
    spawnedPtys.push(term)
    return term
  })
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(() => [{ isDestroyed: () => false, webContents: { send: vi.fn() } }])
  },
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => '/test')
  }
}))

vi.mock('child_process', () => ({
  execSync: vi.fn(() => '')
}))

vi.mock('../heartbeat', () => ({
  removePane: vi.fn()
}))

import { createPty, killPty } from '../ptyManager'
import { removePane } from '../heartbeat'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ptyManager heartbeat integration', () => {
  it('calls removePane on PTY exit', () => {
    createPty('test-pane', undefined, undefined, 80, 24)

    const handlers = exitHandlers['test-pane']
    expect(handlers).toBeDefined()
    expect(handlers['exit']).toHaveLength(1)

    handlers['exit'][0]({ exitCode: 0 })

    expect(removePane).toHaveBeenCalledWith('test-pane')
  })

  it('calls removePane on killPty', () => {
    createPty('test-pane-2', undefined, undefined, 80, 24)
    killPty('test-pane-2')
    expect(removePane).toHaveBeenCalledWith('test-pane-2')
  })

  it('kills the previous pty session when reusing an id (no leak)', () => {
    spawnedPtys.length = 0
    createPty('dup-pane', undefined, undefined, 80, 24)
    createPty('dup-pane', undefined, undefined, 80, 24)
    expect(spawnedPtys).toHaveLength(2)
    // The first session must be killed before the id is overwritten.
    expect(spawnedPtys[0].kill).toHaveBeenCalled()
  })

  it('preserves the user XDG_CONFIG_HOME instead of clobbering it (low)', () => {
    spawnedOpts.length = 0
    process.env.XDG_CONFIG_HOME = '/my/custom/xdg'
    createPty('xdg-pane', undefined, undefined, 80, 24)
    const env = spawnedOpts[0].env as Record<string, string>
    // DESIRED: a user-defined XDG_CONFIG_HOME must survive into the shell env.
    // Currently the spawn env hardcodes XDG_CONFIG_HOME to USERPROFILE\.config,
    // clobbering the user's value — this fails.
    expect(env.XDG_CONFIG_HOME).toBe('/my/custom/xdg')
    delete process.env.XDG_CONFIG_HOME
  })
})
