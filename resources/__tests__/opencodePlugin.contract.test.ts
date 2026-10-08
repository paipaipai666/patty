
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'


const spawnCalls: { cmd: string; args: string[] }[] = []
vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args })
    return { on: vi.fn(), unref: vi.fn() }
  })
}))

import plugin from '../opencode-patty-plugin'
import { isCanonicalEvent } from './hookProtocol'

interface CapturedPost {
  url: string
  body: { paneId?: string; event?: string; source?: string; secret?: string; role?: string }
}

const captured: CapturedPost[] = []

type TestEvent = { type: string;[key: string]: unknown }

const v1MainSession = { info: { id: 's1' } }
const v1SubSession = { info: { id: 's2', parentID: 's1' } }

const v2MainCreated: TestEvent = { type: 'session.created', data: { sessionID: 's1', slug: 'main' } }
const v2SubCreated: TestEvent = { type: 'session.created', data: { sessionID: 's2', parentID: 's1', slug: 'sub' } }

let eventQueue: TestEvent[] = []
let wake: (() => void) | null = null

const v2ctx = {
  event: {
    subscribe: () => (async function* () {
      for (;;) {
        while (eventQueue.length) yield eventQueue.shift()!
        await new Promise<void>((resolve) => { wake = resolve })
        wake = null
      }
    })()
  }
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

async function driveV2(event: TestEvent) {
  eventQueue.push(event)
  wake?.()
  await flush()
}

interface V1Hooks {
  event?: (input: { event: TestEvent }) => Promise<void>
}

let v1hooks: V1Hooks

async function driveV1(event: TestEvent) {
  await v1hooks.event?.({ event })
}

beforeEach(async () => {
  captured.length = 0
  spawnCalls.length = 0
  eventQueue = []
  delete (globalThis as Record<string, unknown>).__pattyOpencodeNotifierPrimary
  process.env.PATTY_PORT = '1'
  process.env.PATTY_PANE_ID = 'pane-1'
  process.env.PATTY_HOOK_SECRET = 'secret-1'
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    captured.push({ url, body: JSON.parse(init.body) })
    return new Response('{}', { status: 200 })
  }))
  v1hooks = await plugin.server()
  await plugin.setup(v2ctx)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()

  process.removeAllListeners('exit')
  delete process.env.PATTY_PORT
  delete process.env.PATTY_PANE_ID
  delete process.env.PATTY_HOOK_SECRET
})

describe('PattyNotifier (opencode plugin, v2 setup path)', () => {
  it('stays inert outside a Patty terminal (no env vars)', async () => {
    delete process.env.PATTY_PORT
    delete process.env.PATTY_PANE_ID
    const setupResult = await plugin.setup(v2ctx)
    const serverHooks = await plugin.server()
    expect(setupResult).toBeUndefined()
    expect(serverHooks).toEqual({})
    await driveV2(v2MainCreated)
    expect(captured).toHaveLength(0)
  })

  it('session.created → session_created with the full envelope', async () => {
    await driveV2(v2MainCreated)
    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('http://127.0.0.1:1/hook')
    expect(captured[0].body).toEqual({
      paneId: 'pane-1',
      event: 'session_created',
      source: 'opencode',
      secret: 'secret-1',
      role: 'main'
    })
  })

  it('subagent session.created 仍转发，但携带 role: subagent', async () => {
    await driveV2(v2MainCreated)
    captured.length = 0
    await driveV2(v2SubCreated)
    expect(captured.map((p) => [p.body.event, p.body.role])).toEqual([['session_created', 'subagent']])
  })

  it('permission.asked and question.asked → permission_prompt', async () => {
    await driveV2({ type: 'permission.asked', data: { sessionID: 's1' } })
    await driveV2({ type: 'question.asked', data: { sessionID: 's1' } })
    expect(captured.map((p) => p.body.event)).toEqual(['permission_prompt', 'permission_prompt'])
  })

  it('session.idle from the main session → idle', async () => {
    await driveV2(v2MainCreated)
    captured.length = 0
    await driveV2({ type: 'session.idle', data: { sessionID: 's1' } })
    expect(captured.map((p) => p.body.event)).toEqual(['idle'])
  })

  it('session.idle from a subagent session is ignored', async () => {
    await driveV2(v2MainCreated)
    captured.length = 0
    await driveV2({ type: 'session.idle', data: { sessionID: 's2' } })
    expect(captured).toHaveLength(0)
  })

  it('session.status idle for a tracked main session → idle', async () => {
    await driveV2(v2MainCreated)
    captured.length = 0
    await driveV2({ type: 'session.status', data: { sessionID: 's1', status: { type: 'idle' } } })
    expect(captured.map((p) => p.body.event)).toEqual(['idle'])
  })

  it('session.status with a non-idle type stays silent', async () => {
    await driveV2(v2MainCreated)
    captured.length = 0
    await driveV2({ type: 'session.status', data: { sessionID: 's1', status: { type: 'busy' } } })
    expect(captured).toHaveLength(0)
  })

  it('session.error → error', async () => {
    await driveV2({ type: 'session.error', data: { sessionID: 's1' } })
    expect(captured.map((p) => p.body.event)).toEqual(['error'])
  })

  it('session.execution.failed → error', async () => {
    await driveV2({ type: 'session.execution.failed', data: { sessionID: 's1', error: { type: 'provider.auth' } } })
    expect(captured.map((p) => p.body.event)).toEqual(['error'])
  })

  it('flat payloads without a data wrapper still normalize', async () => {
    await driveV2({ type: 'session.created', sessionID: 's3', slug: 'flat' })
    captured.length = 0
    await driveV2({ type: 'session.idle', sessionID: 's3' })
    expect(captured.map((p) => p.body.event)).toEqual(['idle'])
  })

  it('double setup instantiation notifies Patty only once', async () => {
    await plugin.setup(v2ctx)
    await driveV2(v2MainCreated)
    expect(captured).toHaveLength(1)
  })

  it('main session.deleted → detached session_deleted delivery', async () => {
    await driveV2(v2MainCreated)
    captured.length = 0
    await driveV2({ type: 'session.deleted', data: { sessionID: 's1' } })
    expect(captured).toHaveLength(0)
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].cmd).toBe('curl')
    const body = JSON.parse(spawnCalls[0].args[spawnCalls[0].args.length - 1])
    expect(body).toEqual({ paneId: 'pane-1', event: 'session_deleted', source: 'opencode', secret: 'secret-1', role: 'main' })
  })

  it('subagent session.deleted does not notify Patty', async () => {
    await driveV2(v2MainCreated)
    await driveV2(v2SubCreated)
    captured.length = 0
    spawnCalls.length = 0

    await driveV2({ type: 'session.deleted', data: { sessionID: 's2', parentID: 's1' } })
    expect(captured).toHaveLength(0)
    expect(spawnCalls).toHaveLength(0)
  })

  it('every emitted event stays within the canonical hook vocabulary', async () => {
    await driveV2(v2MainCreated)
    await driveV2(v2SubCreated)
    await driveV2({ type: 'permission.asked', data: { sessionID: 's1' } })
    await driveV2({ type: 'question.asked', data: { sessionID: 's1' } })
    await driveV2({ type: 'session.idle', data: { sessionID: 's1' } })
    await driveV2({ type: 'session.status', data: { sessionID: 's1', status: { type: 'idle' } } })
    await driveV2({ type: 'session.error', data: { sessionID: 's1' } })
    await driveV2({ type: 'session.deleted', data: { sessionID: 's1' } })
    expect(captured.length).toBeGreaterThan(0)
    for (const p of captured) {
      expect(isCanonicalEvent(p.body.event), p.body.event).toBe(true)
    }
    expect(spawnCalls).toHaveLength(1)
    const detached = JSON.parse(spawnCalls[0].args[spawnCalls[0].args.length - 1])
    expect(isCanonicalEvent(detached.event), detached.event).toBe(true)
  })
})

describe('PattyNotifier (v1 server() compatibility path)', () => {
  it('handles v1 wrapped payloads end to end', async () => {
    await driveV1({ type: 'session.created', properties: v1MainSession })
    expect(captured.map((p) => [p.body.event, p.body.role])).toEqual([['session_created', 'main']])

    await driveV1({ type: 'session.idle', properties: { sessionID: 's1' } })
    expect(captured.map((p) => p.body.event)).toEqual(['session_created', 'idle'])

    captured.length = 0
    await driveV1({ type: 'session.deleted', properties: v1MainSession })
    expect(captured).toHaveLength(0)
    expect(spawnCalls).toHaveLength(1)
    const body = JSON.parse(spawnCalls[0].args[spawnCalls[0].args.length - 1])
    expect(body.event).toBe('session_deleted')
  })

  it('tracks main sessions and ignores subagent noise with v1 payloads', async () => {
    await driveV1({ type: 'session.created', properties: v1MainSession })
    await driveV1({ type: 'session.created', properties: v1SubSession })
    captured.length = 0

    await driveV1({ type: 'session.idle', properties: { sessionID: 's2' } })
    expect(captured).toHaveLength(0)

    await driveV1({ type: 'session.deleted', properties: v1SubSession })
    expect(captured).toHaveLength(0)
    expect(spawnCalls).toHaveLength(0)
  })
})
