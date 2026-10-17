import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PersistedState } from '../../shared/stateTypes'

const { closeMock, flushNowMock, invokeMock } = vi.hoisted(() => ({
  closeMock: vi.fn(),
  flushNowMock: vi.fn(),
  invokeMock: vi.fn()
}))

vi.stubGlobal('window', {})

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close: closeMock })
}))

vi.mock('../store/dirtyScheduler', () => ({ flushNow: flushNowMock }))

const { terminalAPI } = await import('../api')

const state: PersistedState = {
  sessions: [],
  collections: [],
  activeSessionId: null,
  sidebarVisible: true,
  sidebarWidth: 220,
  workspaces: [],
  activeWorkspaceId: null
}

beforeEach(() => {
  closeMock.mockReset()
  flushNowMock.mockReset()
  invokeMock.mockReset()
})

describe('windowClose', () => {
  it('flushes pending state before closing the window', async () => {
    let flushFinished = false
    flushNowMock.mockImplementation(async () => {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
      flushFinished = true
    })
    let flushPendingAtClose = true
    closeMock.mockImplementation(() => {
      flushPendingAtClose = !flushFinished
      return Promise.resolve()
    })

    await terminalAPI.windowClose()

    expect(flushNowMock).toHaveBeenCalledTimes(1)
    expect(closeMock).toHaveBeenCalledTimes(1)
    expect(flushPendingAtClose).toBe(false)
  })

  it('closes the window when the flush rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    flushNowMock.mockRejectedValue(new Error('save failed'))

    await terminalAPI.windowClose()

    expect(closeMock).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('stateSave', () => {
  it('resolves only after the invoke round-trip completes', async () => {
    let release: () => void = () => undefined
    invokeMock.mockImplementation(
      () =>
        new Promise<void>((resolvePromise) => {
          release = () => resolvePromise()
        })
    )
    let saved = false
    const save = Promise.resolve(terminalAPI.stateSave(state)).then(() => {
      saved = true
    })
    await Promise.resolve()
    expect(invokeMock).toHaveBeenCalledWith('state_save', { state })
    expect(saved).toBe(false)
    release()
    await save
    expect(saved).toBe(true)
  })

  it('swallows invoke failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    invokeMock.mockRejectedValue(new Error('state write failed'))

    await expect(terminalAPI.stateSave(state)).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
