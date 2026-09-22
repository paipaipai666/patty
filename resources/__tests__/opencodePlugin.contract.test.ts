
   
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'


const spawnCalls: { cmd: string; args: string[] }[] = []
vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[]) => {
    spawnCalls.push({ cmd, args })
    return { on: vi.fn(), unref: vi.fn() }
  })
}))

import { PattyNotifier } from '../opencode-patty-plugin'
import { isCanonicalEvent } from './hookProtocol'

interface CapturedPost {
  url: string
  body: { paneId?: string; event?: string; source?: string; secret?: string; role?: string }
}

const captured: CapturedPost[] = []


const mainSession = { info: { id: 's1' } }
const subSession = { info: { id: 's2', parentID: 's1' } }


let hook: Awaited<ReturnType<typeof PattyNotifier>>

async function drive(event: Record<string, unknown>) {
  await hook.event?.({ event: event as never })
}

beforeEach(async () => {
  captured.length = 0
  spawnCalls.length = 0
  process.env.PATTY_PORT = '1'
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
      secret: 'secret-1',
      role: 'main'
    })
  })

  it('subagent session.created 仍转发，但携带 role: subagent', async () => {

    await drive({ type: 'session.created', properties: mainSession })
    captured.length = 0
    await drive({ type: 'session.created', properties: subSession })
    expect(captured.map((p) => [p.body.event, p.body.role])).toEqual([['session_created', 'subagent']])
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
    expect(captured).toHaveLength(0)
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].cmd).toBe('curl')
    const body = JSON.parse(spawnCalls[0].args[spawnCalls[0].args.length - 1])
    expect(body).toEqual({ paneId: 'pane-1', event: 'session_deleted', source: 'opencode', secret: 'secret-1', role: 'main' })
  })

  it('subagent session.deleted does not notify Patty', async () => {
    await drive({ type: 'session.created', properties: mainSession })
    await drive({ type: 'session.created', properties: subSession })
    captured.length = 0
    spawnCalls.length = 0

    await drive({ type: 'session.deleted', properties: subSession })
    expect(captured).toHaveLength(0)
    expect(spawnCalls).toHaveLength(0)
  })

  it('every emitted event stays within the canonical hook vocabulary', async () => {

    await drive({ type: 'session.created', properties: mainSession })
    await drive({ type: 'session.created', properties: subSession })
    await drive({ type: 'permission.asked', properties: {} })
    await drive({ type: 'question.asked', properties: {} })
    await drive({ type: 'session.idle', properties: { sessionID: 's1' } })
    await drive({ type: 'session.status', properties: { sessionID: 's1', status: { type: 'idle' } } })
    await drive({ type: 'session.error', properties: {} })
    await drive({ type: 'session.deleted', properties: mainSession })
    expect(captured.length).toBeGreaterThan(0)
    for (const p of captured) {
      expect(isCanonicalEvent(p.body.event), p.body.event).toBe(true)
    }
    expect(spawnCalls).toHaveLength(1)
    const detached = JSON.parse(spawnCalls[0].args[spawnCalls[0].args.length - 1])
    expect(isCanonicalEvent(detached.event), detached.event).toBe(true)
  })
})
