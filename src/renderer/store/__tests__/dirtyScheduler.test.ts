import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest'

const mockStateSave = vi.fn()
vi.stubGlobal('window', {
  terminalAPI: { stateSave: mockStateSave },
  addEventListener: vi.fn()
})

import { configureDirtyScheduler, markDirty, flushNow } from '../dirtyScheduler'
import type { PersistedState } from '../../../shared/stateTypes'

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

  it('does not permanently stall persistence when a flush fires before the builder is configured', async () => {
    // The real trigger: markDirty() can run before configureDirtyScheduler()
    // (e.g. during initial load), so flushNow() executes with a null builder and
    // early-returns WITHOUT resetting `dirty`. A later markDirty() then becomes a
    // no-op and state is never persisted again. We need a fresh module instance
    // to reach the unconfigured (buildPersistedState === null) state.
    vi.resetModules()
    const mod = await import('../dirtyScheduler')

    mod.markDirty()
    vi.advanceTimersByTime(1000) // flushNow with null builder -> early return, dirty stays true
    expect(mockStateSave).not.toHaveBeenCalled()

    mod.configureDirtyScheduler(() => ({
      sessions: [],
      collections: [],
      activeSessionId: null,
      sidebarVisible: true,
      sidebarWidth: 220,
      workspaces: [],
      activeWorkspaceId: null
    }))
    mod.markDirty()
    vi.advanceTimersByTime(1000)

    // BUG: this currently fails — `dirty` was never reset, so the second
    // markDirty scheduled no flush and state is lost until beforeunload.
    expect(mockStateSave).toHaveBeenCalled()
  })
})
