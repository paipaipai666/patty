
   
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'


const spawnCalls: { cmd: string; args: string[]; body: string }[] = []
vi.mock('node:child_process', () => ({
  spawn: vi.fn((cmd: string, args: string[]) => {
    let body = ''
    const stdin = {
      write: (chunk: string) => { body += chunk },
      end: () => {}
    }
    spawnCalls.push({ cmd, args, get body() { return body } })
    return { on: vi.fn(), unref: vi.fn(), stdin }
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
  process.env.PATTY_PORT = '1'
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
      'message_end',
      'session_branch',
      'session_compact',
      'session_shutdown',
      'session_start',
      'session_stop',
      'session_switch',
      'tool_approval_requested',
      'tool_call',
      'turn_end'
    ])
  })

  it('session_start → session_created with the full envelope', async () => {
    PattyNotifier(pi)
    await handlers.get('session_start')?.({}, ctx)
    expect(posted).toEqual([
      { paneId: 'pane-1', event: 'session_created', source: 'omp', secret: 'secret-1',
        origin: { processId: process.pid, sequence: 1, emittedAt: expect.any(Number), instanceId: expect.any(String) } }
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

  it('session_start without a transcript does not throw and opens no transcript bridge when the UI returns no TUI', async () => {
    const registered: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/omp/register')) registered.push(url)
      return new Response('{}')
    }))
    const setWidget = vi.fn((_key: string, _factory: unknown) => {})
    const standardCtx = {
      ...ctx,
      hasUI: true,
      cwd: 'D:/standard',
      ui: { setWidget },
      sessionManager: {
        getSessionId: () => 'standard-session',
        getLeafId: () => null,
        getBranchView: () => []
      }
    }
    PattyNotifier(pi)
    await handlers.get('session_start')?.({}, standardCtx)
    expect(setWidget.mock.calls.map(call => call[0])).toEqual(['patty-navigation', 'patty-navigation'])
    expect(setWidget.mock.calls[1]?.[1]).toBeUndefined()
    expect(registered).toEqual([])
  })

  it('announces a changed conversation before registering it and keeps reconnects as heartbeats', async () => {
    let sessionId = 'session-a'
    const position = () => ({ mode: 'live' as const, sessionId, branchEpoch: 1, displayEpoch: 1, viewRevision: 1, frameId: `frame-${sessionId}` })
    let positionListener: (value: ReturnType<typeof position>) => void = () => {}
    let polls = 0
    let revoked = false
    const hooks: Array<{ event: string | undefined; conversationId: string | undefined }> = []
    const registered: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body: string; signal: AbortSignal }) => {
      const body: { event?: string; origin?: { conversationId?: string } } = JSON.parse(init.body)
      if (url.endsWith('/hook')) {
        hooks.push({ event: body.event, conversationId: body.origin?.conversationId })
        return new Response('{}')
      }
      if (url.endsWith('/omp/register')) {
        const id = body.origin?.conversationId
        if (!id) throw new Error('Missing registration conversation')
        expect(hooks.some(hook => hook.event === 'session_created' && hook.conversationId === id)).toBe(true)
        registered.push(id)
        return new Response(JSON.stringify({ leaseToken: `lease-${id}` }))
      }
      if (url.endsWith('/omp/poll')) {
        polls++
        if (polls === 1) throw new Error('Temporary connection failure')
        return await new Promise<Response>((_, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
        })
      }
      if (url.endsWith('/omp/revoke')) revoked = true
      return new Response('{}')
    }))
    const navigationCtx = {
      ...ctx,
      ui: { transcript: {
        getCapabilities: () => ({ transcriptNavigation: 1, catalogSnapshot: 1, nativeHistoryViewport: 1, frameObservation: 1 }),
        getPosition: position,
        getCatalog: () => ({ sessionId, branchEpoch: 1, catalogRevision: 1, turns: [] }),
        seek: async () => position(), returnToLive: async () => position(),
        onPosition: (listener: typeof positionListener) => { positionListener = listener; return () => { positionListener = () => {} } },
        onCatalog: () => () => {}
      } }
    }
    PattyNotifier(pi)
    try {
      await handlers.get('session_start')?.({}, navigationCtx)
      await vi.waitFor(() => expect(registered).toEqual(['session-a', 'session-a']), { timeout: 3000 })
      expect(hooks).toEqual([
        { event: 'session_created', conversationId: 'session-a' },
        { event: 'alive', conversationId: 'session-a' },
        { event: 'alive', conversationId: 'session-a' }
      ])
      sessionId = 'session-b'
      positionListener(position())
      await vi.waitFor(() => expect(registered).toEqual(['session-a', 'session-a', 'session-b']), { timeout: 3000 })
      expect(hooks.at(-1)).toEqual({ event: 'session_created', conversationId: 'session-b' })
      expect(hooks.filter(hook => hook.event === 'session_created')).toHaveLength(2)
    } finally {
      await handlers.get('session_shutdown')?.({}, navigationCtx)
      await vi.waitFor(() => expect(revoked).toBe(true))
    }
  })

  it('session_stop → idle', async () => {
    PattyNotifier(pi)
    await handlers.get('session_stop')?.({}, ctx)
    await vi.waitFor(() => expect(posted.map((p) => p.event)).toEqual(['idle']))
  })

  it('tool_call reports work instead of only renewing its heartbeat', async () => {
    PattyNotifier(pi)
    await handlers.get('tool_call')?.({}, ctx)
    await vi.waitFor(() => expect(posted.map((p) => p.event)).toEqual(['pre_tool_use']))
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
    expect(posted).toHaveLength(0)
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0].cmd).toBe('curl')
    expect(spawnCalls[0].args).toContain('--data-binary')
    expect(spawnCalls[0].args).toContain('@-')
    expect(spawnCalls[0].args.join(' ')).not.toContain('secret-1')
  })

  it('every emitted event stays within the canonical hook vocabulary', async () => {

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
    const detached = JSON.parse(spawnCalls[0].body)
    expect(isCanonicalEvent(detached.event), detached.event).toBe(true)
  })
})
