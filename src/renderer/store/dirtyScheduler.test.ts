import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest'

const mockStateSave = vi.fn()
vi.stubGlobal('window', {
  terminalAPI: { stateSave: mockStateSave },
  addEventListener: vi.fn()
})

import { configureDirtyScheduler, markDirty, flushNow } from './dirtyScheduler'
import type { PersistedState } from '../../shared/stateTypes'

vi.useFakeTimers()

beforeEach(() => {
  vi.clearAllMocks()
})

afterAll(() => {
  vi.useRealTimers()
})

describe('configureDirtyScheduler', () => {
  it('registers the builder function', () => {
    const builder = vi.fn((): PersistedState | null => null)
    configureDirtyScheduler(builder)
    markDirty()
    vi.advanceTimersByTime(1000)
    expect(builder).toHaveBeenCalled()
  })
})

describe('markDirty', () => {
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
    configureDirtyScheduler(builder)

    markDirty()
    markDirty()
    markDirty()
    expect(builder).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1000)
    expect(builder).toHaveBeenCalledTimes(1)
    expect(mockStateSave).toHaveBeenCalled()
  })

  it('does not call stateSave when builder returns null', () => {
    configureDirtyScheduler(() => null)
    markDirty()
    vi.advanceTimersByTime(1000)
    expect(mockStateSave).not.toHaveBeenCalled()
  })

  it('does nothing when no builder is configured', () => {
    markDirty()
    vi.advanceTimersByTime(1000)
    expect(mockStateSave).not.toHaveBeenCalled()
  })
})

describe('flushNow', () => {
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
    configureDirtyScheduler(builder)
    flushNow()
    expect(builder).toHaveBeenCalledTimes(1)
    expect(mockStateSave).toHaveBeenCalled()
  })
})
