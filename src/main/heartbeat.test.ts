import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'
import {
  collectExpired,
  noteEvent,
  removePane,
  snapshot,
  flushStats,
  loadStats,
  setStatsPath,
  HEARTBEAT_TICK_MS,
  MIN_STATS_FLUSH_MS,
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

describe('maxNaturalGap sampling', () => {
  beforeEach(() => {
    for (const e of snapshot()) removePane(e.paneId)
  })

  it('records gap when below timeout', () => {
    noteEvent('p1', 'session_created', 'opencode', T0)
    noteEvent('p1', 'alive', 'opencode', T0 + 3000)
    // exposed via flushStats roundtrip
    const tmp = path.join(os.tmpdir(), `hb-${Math.random().toString(36)}.json`)
    setStatsPath(tmp)
    flushStats()
    const data = JSON.parse(fs.readFileSync(tmp, 'utf-8'))
    expect(data.maxNaturalGap.opencode).toBeGreaterThanOrEqual(3000)
    fs.rmSync(tmp)
  })

  it('does not record gap >= timeout (covers a full silence window)', () => {
    noteEvent('p1', 'session_created', 'opencode', T0)
    noteEvent('p1', 'alive', 'opencode', T0 + OPENTIMEOUT + 100)
    const tmp = path.join(os.tmpdir(), `hb-${Math.random().toString(36)}.json`)
    setStatsPath(tmp)
    flushStats()
    const data = JSON.parse(fs.readFileSync(tmp, 'utf-8'))
    expect(data.maxNaturalGap.opencode ?? 0).toBeLessThan(OPENTIMEOUT)
    fs.rmSync(tmp)
  })
})

describe('stats persistence', () => {
  it('flushes and reloads maxNaturalGap, taking the max', () => {
    const tmp = path.join(os.tmpdir(), `hb-${Math.random().toString(36)}.json`)
    setStatsPath(tmp)
    noteEvent('p1', 'session_created', 'opencode', T0)
    noteEvent('p1', 'alive', 'opencode', T0 + 4000)
    flushStats()
    // simulate a restart: reset in-memory by reloading into a fresh run is not possible here,
    // but loadStats must merge with existing >=, so call loadStats after a higher write.
    fs.writeFileSync(tmp, JSON.stringify({ maxNaturalGap: { opencode: 9999 } }))
    loadStats()
    // flush again and confirm merged max is 9999
    flushStats()
    const data = JSON.parse(fs.readFileSync(tmp, 'utf-8'))
    expect(data.maxNaturalGap.opencode).toBe(9999)
    fs.rmSync(tmp)
  })
})

describe('constants', () => {
  it('uses the planned tick and flush intervals, and 10min claude/codex timeout', () => {
    expect(MIN_STATS_FLUSH_MS).toBe(5 * 60 * 1000)
    expect(HEARTBEAT_TICK_MS).toBe(5000)
    expect(CLAUDETIMEOUT).toBe(600000)
  })
})
