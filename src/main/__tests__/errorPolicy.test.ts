import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('node-pty', () => ({ spawn: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  app: { isPackaged: false, getAppPath: vi.fn(() => '/test') }
}))
vi.mock('child_process', () => ({ execSync: vi.fn(() => '') }))
vi.mock('../heartbeat', () => ({ removePane: vi.fn() }))

import { onUncaughtException, onUnhandledRejection } from '../errorPolicy'

function netError(code: string): Error {
  return Object.assign(new Error('network'), { code })
}

describe('error handlers (policy B)', () => {
  beforeEach(() => {
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not exit on a network uncaughtException', () => {
    onUncaughtException(netError('EPIPE'))
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('exits on a non-network uncaughtException', () => {
    onUncaughtException(new Error('boom'))
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it('never exits on an unhandledRejection (non-network) — C1 fix', () => {
    onUnhandledRejection(new Error('boom'))
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('does not exit on a network unhandledRejection', () => {
    onUnhandledRejection(netError('ECONNRESET'))
    expect(process.exit).not.toHaveBeenCalled()
  })
})
