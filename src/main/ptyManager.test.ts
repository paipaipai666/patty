import { describe, it, expect, vi, beforeEach } from 'vitest'

const exitHandlers: Record<string, Record<string, Function[]>> = {}

vi.mock('node-pty', () => ({
  spawn: vi.fn((_: string, __: string[], opts: Record<string, unknown>) => {
    const id = (opts?.env as Record<string, string>)?.['PATTY_PANE_ID'] ?? 'unknown'
    const handlers: Record<string, Function[]> = {}
    exitHandlers[id] = handlers
    return {
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

vi.mock('./heartbeat', () => ({
  removePane: vi.fn()
}))

import { createPty, killPty } from './ptyManager'
import { removePane } from './heartbeat'

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
})
