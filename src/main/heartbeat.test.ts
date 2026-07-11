import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  collectExpired,
  noteEvent,
  removePane,
  snapshot,
  HEARTBEAT_TICK_MS,
  type ActiveEntry
} from './heartbeat'

const T0 = 1_000_000
const OPENTIMEOUT = 15000
const CLAUDETIMEOUT = 600000

describe('collectExpired (pure)', () => {
  it('does not expire before timeout', () => {
    const map = new Map<string, ActiveEntry>([
      ['p1', { source: 'opencode', lastSeen: T0 }]
    ])
    expect(collectExpired(map, T0 + OPENTIMEOUT - 1)).toEqual([])
  })

  it('expires after timeout', () => {
    const map = new Map<string, ActiveEntry>([
      ['p1', { source: 'opencode', lastSeen: T0 }]
    ])
    expect(collectExpired(map, T0 + OPENTIMEOUT + 1)).toEqual(['p1'])
  })

  it('ignores sources with no config (never expires)', () => {
    const map = new Map<string, ActiveEntry>([
      ['p1', { source: 'unknown', lastSeen: T0 }]
    ])
    expect(collectExpired(map, T0 + 10_000_000)).toEqual([])
  })

  it('expires only the stale entries', () => {
    const map = new Map<string, ActiveEntry>([
      ['p1', { source: 'opencode', lastSeen: T0 }],
      ['p2', { source: 'opencode', lastSeen: T0 + OPENTIMEOUT + 100 }]
    ])
    expect(collectExpired(map, T0 + OPENTIMEOUT + 1).sort()).toEqual(['p1'])
  })
})

describe('noteEvent', () => {
  beforeEach(() => {
    for (const e of snapshot()) removePane(e.paneId)
  })

  it('session_created seeds an active entry', () => {
    noteEvent('p1', 'session_created', 'opencode', T0)
    expect(snapshot()).toEqual([{ paneId: 'p1', source: 'opencode', lastSeen: T0 }])
  })

  it('session_start seeds an active entry (claude/codex)', () => {
    noteEvent('p2', 'session_start', 'claude-code', T0)
    expect(snapshot()).toEqual([{ paneId: 'p2', source: 'claude-code', lastSeen: T0 }])
  })

  it('session_end removes the entry immediately', () => {
    noteEvent('p1', 'session_created', 'opencode', T0)
    noteEvent('p1', 'session_end', 'opencode', T0 + 100)
    expect(snapshot()).toEqual([])
  })

  it('session_deleted removes the entry immediately', () => {
    noteEvent('p1', 'session_created', 'opencode', T0)
    noteEvent('p1', 'session_deleted', 'opencode', T0 + 100)
    expect(snapshot()).toEqual([])
  })

  it('alive refreshes lastSeen and prevents expiry', () => {
    noteEvent('p1', 'session_created', 'opencode', T0)
    noteEvent('p1', 'alive', 'opencode', T0 + OPENTIMEOUT + 5000)
    const map = new Map(snapshot().map((e) => [e.paneId, e]))
    // total elapsed > timeout, but refreshed recently -> not expired
    expect(collectExpired(map, T0 + OPENTIMEOUT + 5000)).toEqual([])
  })

  it('ignores events for untracked panes', () => {
    noteEvent('p1', 'alive', 'opencode', T0)
    expect(snapshot()).toEqual([])
  })

  it('warns and ignores unknown sources', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    noteEvent('p1', 'session_created', 'bogus', T0)
    expect(warn).toHaveBeenCalled()
    expect(snapshot()).toEqual([])
    warn.mockRestore()
  })

  it('pane reuse: stale entry is overwritten by a fresh session_start', () => {
    noteEvent('p1', 'session_created', 'opencode', T0)
    // stale tick
    const staleMap = new Map(snapshot().map((e) => [e.paneId, e]))
    expect(collectExpired(staleMap, T0 + OPENTIMEOUT + 1)).toEqual(['p1'])
    // new session_start for same pane id refreshes
    noteEvent('p1', 'session_start', 'claude-code', T0 + OPENTIMEOUT + 1)
    const refreshed = new Map(snapshot().map((e) => [e.paneId, e]))
    expect(collectExpired(refreshed, T0 + OPENTIMEOUT + 1)).toEqual([])
    expect(snapshot()[0].source).toBe('claude-code')
  })
})

describe('constants', () => {
  it('uses the planned tick interval, and 10min claude/codex timeout', () => {
    expect(HEARTBEAT_TICK_MS).toBe(5000)
    expect(CLAUDETIMEOUT).toBe(600000)
  })
})
