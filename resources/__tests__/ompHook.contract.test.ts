/**
 * Contract tests: omp raw extension events → normalized Patty hook events.
 *
 * The extension maps omp's event names onto Patty's envelope. If an omp
 * upgrade renames events (session_stop, tool_approval_requested, …), these
 * tests fail instead of the attention indicators silently going dark.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// session_deleted is delivered via a detached curl process so it survives
// omp's exit; mock spawn to capture it.
const spawnCalls: { cmd: string; args: string[] }[] = []
vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args })
    return { on: vi.fn(), unref: vi.fn() }
  })
}))

import PattyNotifier from '../omp-patty-hook'
import { isCanonicalEvent } from './hookProtocol'

const posted: Array<{ paneId?: string; event?: string; source?: string; secret?: string }> = []

type Handler = (event: unknown, ctx: { setInterval(fn: () => void, ms: number): void }) => unknown

let handlers: Map<string, Handler>
let intervalCallbacks: Array<{ fn: () => void; ms: number }>

const pi = {
  on: vi.fn((event: string, handler: Handler) => {
    handlers.set(event, handler)
  })
}

const ctx = {
  setInterval: vi.fn((fn: () => void, ms: number) => {
    intervalCallbacks.push({ fn, ms })
  })
}

beforeEach(() => {
  posted.length = 0
  spawnCalls.length = 0
  handlers = new Map()
  intervalCallbacks = []
  process.env.PATTY_PORT = '1' // unroutable port; fetch is stubbed anyway
  process.env.PATTY_PANE_ID = 'pane-1'
  process.env.PATTY_HOOK_SECRET = 'secret-1'
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    posted.push(JSON.parse(init.body))
    return new Response('{}', { status: 200 })
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.PATTY_PORT
  delete process.env.PATTY_PANE_ID
  delete process.env.PATTY_HOOK_SECRET
})

describe('PattyNotifier (omp extension)', () => {
  it('stays inert outside a Patty terminal (no env vars)', () => {
    delete process.env.PATTY_PORT
    delete process.env.PATTY_PANE_ID
    PattyNotifier(pi)
    expect(handlers.size).toBe(0)
  })

  it('registers handlers for the omp events it consumes', () => {
    PattyNotifier(pi)
    expect([...handlers.keys()].sort()).toEqual([
      'auto_retry_start',
      'session_shutdown',
      'session_start',
      'session_stop',
      'tool_approval_requested',
      'tool_call'
    ])
  })

  it('session_start → session_created with the full envelope', async () => {
    PattyNotifier(pi)
    await handlers.get('session_start')?.({}, ctx)
    expect(posted).toEqual([
      { paneId: 'pane-1', event: 'session_created', source: 'omp', secret: 'secret-1' }
    ])
  })

  it('session_start arms a 5s alive heartbeat via the omp-managed timer', async () => {
    PattyNotifier(pi)
    await handlers.get('session_start')?.({}, ctx)
    expect(intervalCallbacks).toHaveLength(1)
    expect(intervalCallbacks[0].ms).toBe(5000)
    posted.length = 0
    intervalCallbacks[0].fn()
    await vi.waitFor(() => expect(posted.map((p) => p.event)).toEqual(['alive']))
  })

  it('session_stop → idle', async () => {
    PattyNotifier(pi)
    await handlers.get('session_stop')?.({}, ctx)
    await vi.waitFor(() => expect(posted.map((p) => p.event)).toEqual(['idle']))
  })

  it('tool_call → alive', async () => {
    PattyNotifier(pi)
    await handlers.get('tool_call')?.({}, ctx)
    await vi.waitFor(() => expect(posted.map((p) => p.event)).toEqual(['alive']))
  })

  it('tool_approval_requested → permission_prompt', async () => {
    PattyNotifier(pi)
    await handlers.get('tool_approval_requested')?.({}, ctx)
    await vi.waitFor(() => expect(posted.map((p) => p.event)).toEqual(['permission_prompt']))
  })

  it('auto_retry_start → error_retry', async () => {
    PattyNotifier(pi)
    await handlers.get('auto_retry_start')?.({}, ctx)
    await vi.waitFor(() => expect(posted.map((p) => p.event)).toEqual(['error_retry']))
  })

  it('session_shutdown → detached session_deleted delivery', async () => {
    PattyNotifier(pi)
    await handlers.get('session_shutdown')?.({}, ctx)
    expect(posted).toHaveLength(0) // detached path bypasses fetch
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].cmd).toBe('curl')
    const body = JSON.parse(spawnCalls[0].args[spawnCalls[0].args.length - 1])
    expect(body).toEqual({ paneId: 'pane-1', event: 'session_deleted', source: 'omp', secret: 'secret-1' })
  })

  it('every emitted event stays within the canonical hook vocabulary', async () => {
    // 覆盖全部六条 handler + 心跳 + detached 投递路径；任何 omp 升级导致的
    // 改名/新增都会越过 fetch/curl 边界前在这里撞上词汇表。
    PattyNotifier(pi)
    for (const name of ['session_start', 'session_stop', 'tool_call', 'tool_approval_requested', 'auto_retry_start']) {
      await handlers.get(name)?.({}, ctx)
    }
    intervalCallbacks[0]?.fn()
    await handlers.get('session_shutdown')?.({}, ctx)
    await vi.waitFor(() => expect(posted.length).toBeGreaterThanOrEqual(5))
    for (const p of posted) {
      expect(isCanonicalEvent(p.event), p.event).toBe(true)
    }
    const detached = JSON.parse(spawnCalls[0].args[spawnCalls[0].args.length - 1])
    expect(isCanonicalEvent(detached.event), detached.event).toBe(true)
  })
})
