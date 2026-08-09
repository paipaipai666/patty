/**
 * Contract tests: opencode raw event payloads → normalized Patty hook events.
 *
 * The plugin is the translation boundary between opencode's event stream and
 * Patty's normalized {paneId, event, source, secret} envelope. If an opencode
 * upgrade renames event types or moves payload fields (as opencode 1.18 did by
 * dropping session.deleted), these tests fail instead of the flames silently
 * going dark.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The plugin delivers session_deleted via a detached curl process (fire-and-
// forget fetch would not survive opencode's exit). Mock spawn to capture it.
const spawnCalls: { cmd: string; args: string[] }[] = []
vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args })
    return { on: vi.fn(), unref: vi.fn() }
  })
}))

import { PattyNotifier } from '../opencode-patty-plugin'

interface CapturedPost {
  url: string
  body: { paneId?: string; event?: string; source?: string; secret?: string }
}

const captured: CapturedPost[] = []

// opencode event shapes as observed by the plugin (properties.info / sessionID).
const mainSession = { info: { id: 's1' } }
const subSession = { info: { id: 's2', parentID: 's1' } }

// One instance per test: mainSessions tracking lives inside the closure.
let hook: Awaited<ReturnType<typeof PattyNotifier>>

async function drive(event: Record<string, unknown>) {
  await hook.event?.({ event: event as never })
}

beforeEach(async () => {
  captured.length = 0
  spawnCalls.length = 0
  process.env.PATTY_PORT = '1' // unroutable port; fetch is stubbed anyway
  process.env.PATTY_PANE_ID = 'pane-1'
  process.env.PATTY_HOOK_SECRET = 'secret-1'
  vi.useFakeTimers()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string }) => {
    captured.push({ url, body: JSON.parse(init.body) })
    return new Response('{}', { status: 200 })
  }))
  hook = await PattyNotifier({})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  // Each PattyNotifier() call registers a process 'exit' listener; dropping
  // them keeps listener-leak warnings out of the suite. Vitest does not rely
  // on 'exit' listeners mid-run.
  process.removeAllListeners('exit')
  delete process.env.PATTY_PORT
  delete process.env.PATTY_PANE_ID
  delete process.env.PATTY_HOOK_SECRET
})

describe('PattyNotifier (opencode plugin)', () => {
  it('stays inert outside a Patty terminal (no env vars)', async () => {
    delete process.env.PATTY_PORT
    delete process.env.PATTY_PANE_ID
    const hook = await PattyNotifier({})
    await hook.event?.({ event: { type: 'session.created', properties: mainSession } as never })
    expect(captured).toHaveLength(0)
  })

  it('session.created → session_created with the full envelope', async () => {
    await drive({ type: 'session.created', properties: mainSession })
    expect(captured).toHaveLength(1)
    expect(captured[0].url).toBe('http://127.0.0.1:1/hook')
    expect(captured[0].body).toEqual({
      paneId: 'pane-1',
      event: 'session_created',
      source: 'opencode',
      secret: 'secret-1'
    })
  })

  it('permission.asked and question.asked → permission_prompt', async () => {
    await drive({ type: 'permission.asked', properties: {} })
    await drive({ type: 'question.asked', properties: {} })
    expect(captured.map((p) => p.body.event)).toEqual(['permission_prompt', 'permission_prompt'])
  })

  it('session.idle from the main session → idle', async () => {
    await drive({ type: 'session.created', properties: mainSession })
    captured.length = 0
    await drive({ type: 'session.idle', properties: { sessionID: 's1' } })
    expect(captured.map((p) => p.body.event)).toEqual(['idle'])
  })

  it('session.idle from a subagent session is ignored', async () => {
    await drive({ type: 'session.created', properties: mainSession })
    captured.length = 0
    await drive({ type: 'session.idle', properties: { sessionID: 's2' } })
    expect(captured).toHaveLength(0)
  })

  it('session.status idle for a tracked main session → idle', async () => {
    await drive({ type: 'session.created', properties: mainSession })
    captured.length = 0
    await drive({ type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } })
    expect(captured.map((p) => p.body.event)).toEqual(['idle'])
  })

  it('session.status with a non-idle type stays silent', async () => {
    await drive({ type: 'session.created', properties: mainSession })
    captured.length = 0
    await drive({ type: 'session.status', properties: { sessionID: 's1', status: { type: 'busy' } } })
    expect(captured).toHaveLength(0)
  })

  it('session.error → error', async () => {
    await drive({ type: 'session.error', properties: {} })
    expect(captured.map((p) => p.body.event)).toEqual(['error'])
  })

  it('main session.deleted → detached session_deleted delivery', async () => {
    await drive({ type: 'session.created', properties: mainSession })
    captured.length = 0
    await drive({ type: 'session.deleted', properties: mainSession })
    expect(captured).toHaveLength(0) // detached path bypasses fetch
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].cmd).toBe('curl')
    const body = JSON.parse(spawnCalls[0].args[spawnCalls[0].args.length - 1])
    expect(body).toEqual({ paneId: 'pane-1', event: 'session_deleted', source: 'opencode', secret: 'secret-1' })
  })

  it('subagent session.deleted does not notify Patty', async () => {
    await drive({ type: 'session.created', properties: mainSession })
    await drive({ type: 'session.created', properties: subSession })
    captured.length = 0
    spawnCalls.length = 0
    // Subagent deletion goes through the detached path only for main sessions;
    // for subagents it must be dropped entirely.
    await drive({ type: 'session.deleted', properties: subSession })
    expect(captured).toHaveLength(0)
    expect(spawnCalls).toHaveLength(0)
  })
})
