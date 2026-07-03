import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest'

const mockStateSave = vi.fn()
vi.stubGlobal('window', {
  terminalAPI: { stateSave: mockStateSave },
  addEventListener: vi.fn()
})

import { configureStatePersistence, requestStateSave, saveStateNow } from './statePersistence'
import type { PersistedState } from '../../shared/stateTypes'

vi.useFakeTimers()

beforeEach(() => {
  vi.clearAllMocks()
})

afterAll(() => {
  vi.useRealTimers()
})

describe('configureStatePersistence', () => {
  it('registers the builder function', () => {
    const builder = vi.fn((): PersistedState | null => null)
    configureStatePersistence(builder)
    requestStateSave()
    vi.advanceTimersByTime(500)
    expect(builder).toHaveBeenCalled()
  })
})

describe('requestStateSave', () => {
  it('debounces multiple calls into one save', () => {
    const builder = vi.fn((): PersistedState | null => ({
      sessions: [],
      collections: [],
      activeSessionId: null,
      sidebarVisible: true,
      sidebarWidth: 220,
      workspaces: [],
      activeWorkspaceId: null
    }))
    configureStatePersistence(builder)

    requestStateSave()
    requestStateSave()
    requestStateSave()
    expect(builder).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(builder).toHaveBeenCalledTimes(1)
    expect(mockStateSave).toHaveBeenCalled()
  })

  it('does not call stateSave when builder returns null', () => {
    configureStatePersistence(() => null)
    requestStateSave()
    vi.advanceTimersByTime(500)
    expect(mockStateSave).not.toHaveBeenCalled()
  })

  it('does nothing when no builder is configured', () => {
    requestStateSave()
    vi.advanceTimersByTime(500)
    expect(mockStateSave).not.toHaveBeenCalled()
  })
})

describe('saveStateNow', () => {
  it('flushes state immediately via the builder', () => {
    const builder = vi.fn((): PersistedState | null => ({
      sessions: [],
      collections: [],
      activeSessionId: null,
      sidebarVisible: true,
      sidebarWidth: 220,
      workspaces: [],
      activeWorkspaceId: null
    }))
    configureStatePersistence(builder)
    saveStateNow()
    expect(builder).toHaveBeenCalledTimes(1)
    expect(mockStateSave).toHaveBeenCalled()
  })
})
