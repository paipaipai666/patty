import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PersistedState } from '../../shared/stateTypes'
import type { AgentUpdate } from '../../shared/agentTypes'
import type { ProgramBatch } from '../../shared/programTypes'

const { closeMock, flushNowMock, invokeMock, listenMock } = vi.hoisted(() => ({
  closeMock: vi.fn(),
  flushNowMock: vi.fn(),
  invokeMock: vi.fn(),
  listenMock: vi.fn()
}))

vi.stubGlobal('window', {})

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }))

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
  listenMock.mockReset()
})

describe('agent state IPC', () => {
  it('validates program snapshots and event batches at the IPC boundary', async () => {
    const batch: ProgramBatch = { revision: 3, programs: [{ paneId: 'p1', revision: 3, runId: '1', recordCount: 1, program: { id: '', revision: 1, state: 'blocked', kind: 'auth' } }] }
    invokeMock.mockResolvedValueOnce(batch)
    await expect(terminalAPI.programStateSnapshot()).resolves.toEqual(batch)
    expect(invokeMock).toHaveBeenCalledWith('program_state_snapshot')
    invokeMock.mockResolvedValueOnce({ ...batch, programs: [{ ...batch.programs[0], recordCount: 0 }] })
    await expect(terminalAPI.programStateSnapshot()).rejects.toThrow('Invalid program state snapshot')
    let deliver: (event: { payload: unknown }) => void = () => {}
    const unsubscribe = vi.fn()
    listenMock.mockImplementation((_name: string, callback: typeof deliver) => {
      deliver = callback
      return Promise.resolve(unsubscribe)
    })
    const received: ProgramBatch[] = []
    const handle = terminalAPI.onProgramUpdate(value => received.push(value))
    await handle.ready
    deliver({ payload: batch })
    deliver({ payload: { revision: 3, programs: [batch.programs[0], null] } })
    expect(received).toEqual([batch])
    handle.unsubscribe()
    await Promise.resolve()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
  it('validates native material results at the IPC boundary', async () => {
    const request = { enabled: true, appearance: 'dark', background: [27, 29, 32] } satisfies import('../../shared/windowMaterial').WindowMaterialRequest
    invokeMock.mockResolvedValueOnce('mica')
    await expect(terminalAPI.windowSetMaterial(request)).resolves.toBe('mica')
    expect(invokeMock).toHaveBeenCalledWith('window_set_material', { request })
    invokeMock.mockResolvedValueOnce({ effect: 'blur' })
    await expect(terminalAPI.windowSetMaterial(request)).rejects.toThrow('Invalid window material response')
  })

  it('loads and validates the authoritative agent snapshot', async () => {
    const snapshot = { revision: 4, agents: [{ paneId: 'p1', revision: 3, agent: { aiType: 'codex', status: 'working' } }] }
    invokeMock.mockResolvedValueOnce(snapshot)
    await expect(terminalAPI.agentStateSnapshot()).resolves.toEqual(snapshot)
    expect(invokeMock).toHaveBeenCalledWith('agent_state_snapshot')
    invokeMock.mockResolvedValueOnce({ revision: 4, agents: [{ paneId: 'p1', revision: 8, agent: null }] })
    await expect(terminalAPI.agentStateSnapshot()).rejects.toThrow()
  })

  it('delivers validated state objects and ignores malformed payloads', () => {
    let deliver: (event: { payload: unknown }) => void = () => undefined
    listenMock.mockImplementation((_name: string, callback: typeof deliver) => {
      deliver = callback
      return Promise.resolve(() => undefined)
    })
    const updates: AgentUpdate[] = []
    terminalAPI.onAgentUpdate((update) => updates.push(update))
    deliver({ payload: { paneId: 'p1', revision: 1, agent: { aiType: 'codex', status: 'working' } } })
    deliver({ payload: ['p1', 'permission', 'claude'] })
    deliver({ payload: { paneId: 'p1', revision: 1, agent: { aiType: 'codex', status: 'invented' } } })
    deliver({ payload: { paneId: 'p1', revision: 1, agent: null } })
    expect(updates).toEqual([
      { paneId: 'p1', revision: 1, agent: { aiType: 'codex', status: 'working' } },
      { paneId: 'p1', revision: 1, agent: null }
    ])
  })
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
