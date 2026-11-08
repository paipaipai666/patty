import { createServer } from 'node:http'
import { once } from 'node:events'
import { describe, it, expect } from 'vitest'
import { startNavigationBridge } from '../omp-patty-hook'

describe('OMP navigation bridge', () => {
  it('does not register or poll after stop while session initialization is pending', async () => {
    const paths: string[] = []
    let releaseSession: () => void = () => {}
    const sessionReady = new Promise<void>(resolve => { releaseSession = resolve })
    const server = createServer((request, response) => {
      paths.push(request.url ?? '')
      response.setHeader('Content-Type', 'application/json')
      response.end(request.url === '/omp/register' ? '{"leaseToken":"late-lease"}' : '{"command":null}')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test listener')
    const position = { mode: 'live' as const, sessionId: 'session-1', branchEpoch: 1, displayEpoch: 1, viewRevision: 1, frameId: 'live' }
    const bridge = startNavigationBridge({ baseUrl: `http://127.0.0.1:${address.port}`, paneId: 'pane-1', secret: 'secret-1',
      origin: () => ({ processId: 20, sequence: 2, emittedAt: 100, instanceId: 'instance-1', conversationId: 'session-1' }),
      onSession: () => sessionReady,
      transcript: {
        getCapabilities: () => ({ transcriptNavigation: 1, catalogSnapshot: 1, nativeHistoryViewport: 1, frameObservation: 1 }),
        getPosition: () => position,
        getCatalog: () => ({ sessionId: 'session-1', branchEpoch: 1, catalogRevision: 1, turns: [] }),
        seek: async () => { throw new Error('stopped bridge executed seek') },
        returnToLive: async () => { throw new Error('stopped bridge executed return to live') },
        onPosition: () => () => {}, onCatalog: () => () => {}
      }
    })
    try {
      bridge.stop()
      releaseSession()
      await bridge.done
      expect(paths).toEqual([])
    } finally {
      bridge.stop()
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('retries lost admission and applied responses without executing the native seek twice', async () => {
    const acceptedIds: string[] = []
    const appliedBodies: unknown[] = []
    let admitted = false
    let seeks = 0
    let finish: () => void = () => {}
    const completed = new Promise<void>(resolve => { finish = resolve })
    const server = createServer(async (request, response) => {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const body: Record<string, unknown> = JSON.parse(raw)
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/omp/register') response.end('{"leaseToken":"stable-lease"}')
      else if (request.url === '/omp/poll') {
        if (!admitted) response.end(JSON.stringify({ command: { requestId: 'request-retry', seq: 1, sessionId: 'session-1', branchEpoch: 1, displayEpoch: 1, remainingAdmissionTtlMs: 4900, target: { kind: 'turn', entryId: 'entry-1' } } }))
        else setTimeout(() => response.end('{"command":null}'), 30)
      } else if (request.url === '/omp/accept') {
        acceptedIds.push(String(body.requestId))
        admitted = true
        if (acceptedIds.length === 1) request.socket.destroy()
        else response.end('{"admission":{"requestId":"request-retry","admissionId":"stable-admission","executionBudgetMs":5000}}')
      } else if (request.url === '/omp/authorize') {
        response.end('{"authorized":true,"executionBudgetMs":5000}')
      } else if (body.kind === 'applied') {
        appliedBodies.push(body)
        if (appliedBodies.length === 1) request.socket.destroy()
        else { response.end('{"ok":true}'); finish() }
      } else response.end('{"ok":true}')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test listener')
    const initial = { mode: 'live' as const, sessionId: 'session-1', branchEpoch: 1, displayEpoch: 1, viewRevision: 1, frameId: 'live' }
    const target = { ...initial, mode: 'browsing' as const, entryId: 'entry-1', anchor: { partId: 'entry-1:user', scalarOffset: 0 }, frameId: 'target', viewRevision: 2 }
    const bridge = startNavigationBridge({ baseUrl: `http://127.0.0.1:${address.port}`, paneId: 'pane-1', secret: 'secret-1',
      origin: () => ({ processId: 20, sequence: 2, emittedAt: 100, instanceId: 'instance-1', conversationId: 'session-1' }),
      onSession: async () => {},
      transcript: {
        getCapabilities: () => ({ transcriptNavigation: 1, catalogSnapshot: 1, nativeHistoryViewport: 1, frameObservation: 1 }),
        getPosition: () => initial,
        getCatalog: () => ({ sessionId: 'session-1', branchEpoch: 1, catalogRevision: 1, turns: [{ entryId: 'entry-1', summary: 'Question', timestamp: 100 }] }),
        seek: async () => { seeks++; return target },
        returnToLive: async () => initial,
        onPosition: () => () => {}, onCatalog: () => () => {}
      }
    })
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([completed, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('lost responses were not retried')), 3000) })])
      expect(acceptedIds).toEqual(['request-retry', 'request-retry'])
      expect(seeks).toBe(1)
      expect(appliedBodies).toEqual([
        { kind: 'applied', requestId: 'request-retry', admissionId: 'stable-admission', position: target },
        { kind: 'applied', requestId: 'request-retry', admissionId: 'stable-admission', position: target }
      ])
    } finally {
      clearTimeout(timeout)
      bridge.stop()
      await bridge.done
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('registers the session, publishes a catalog and applies an admitted absolute turn target', async () => {
    const received: { path: string; auth: string | undefined; body: Record<string, unknown> }[] = []
    let position = { mode: 'live' as const, sessionId: 'session-1', branchEpoch: 4, displayEpoch: 7, viewRevision: 1, frameId: 'frame-live' }
    const seeks: unknown[] = []
    let finish: (() => void) | undefined
    const applied = new Promise<void>(resolve => { finish = resolve })
    const server = createServer(async (request, response) => {
      let body = ''
      for await (const chunk of request) body += chunk
      const parsed: Record<string, unknown> = JSON.parse(body)
      received.push({ path: request.url ?? '', auth: request.headers.authorization, body: parsed })
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/omp/register') response.end(JSON.stringify({ leaseToken: 'lease-1' }))
      else if (request.url === '/omp/poll') {
        if (parsed.receivedThrough === 0) response.end(JSON.stringify({ command: {
          requestId: 'request-1', seq: 1, sessionId: 'session-1', branchEpoch: 4, displayEpoch: 7,
          remainingAdmissionTtlMs: 4900, target: { kind: 'turn', entryId: 'entry-1' }
        } }))
        else setTimeout(() => response.end('{"command":null}'), 30)
      } else if (request.url === '/omp/accept') response.end('{"admission":{"requestId":"request-1","admissionId":"admission-1","executionBudgetMs":5000}}')
      else if (request.url === '/omp/authorize') response.end('{"authorized":true,"executionBudgetMs":5000}')
      else {
        response.end('{"ok":true}')
        if (parsed.kind === 'applied') finish?.()
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test listener')
    const bridge = startNavigationBridge({ baseUrl: `http://127.0.0.1:${address.port}`, paneId: 'pane-1', secret: 'secret-1',
      origin: () => ({ processId: 20, sequence: 2, emittedAt: 100, instanceId: 'instance-1', conversationId: 'session-1' }),
      onSession: async () => {},
      transcript: {
        getCapabilities: () => ({ transcriptNavigation: 1, catalogSnapshot: 1, nativeHistoryViewport: 1, frameObservation: 1 }),
        getPosition: () => position,
        getCatalog: () => ({ sessionId: 'session-1', branchEpoch: 4, catalogRevision: 2,
          turns: [{ entryId: 'entry-1', summary: 'Find the first question', timestamp: 100 }] }),
        seek: async target => { seeks.push(target); return { ...position, mode: 'browsing', entryId: target.entryId,
          anchor: { partId: 'entry-1:user', scalarOffset: 0 }, frameId: 'frame-target', viewRevision: 2 } },
        returnToLive: async () => position,
        onPosition: () => () => {}, onCatalog: () => () => {}
      }
    })
    try {
      await Promise.race([applied, new Promise((_, reject) => setTimeout(() => reject(new Error('bridge did not apply')), 3000))])
      expect(seeks).toEqual([{ entryId: 'entry-1', expectedBranchEpoch: 4, expectedDisplayEpoch: 7 }])
      expect(received.find(item => item.path === '/omp/register')).toEqual({ path: '/omp/register', auth: 'Bearer secret-1', body: {
        protocolVersion: 1, paneId: 'pane-1', origin: { processId: 20, sequence: 2, emittedAt: 100, instanceId: 'instance-1', conversationId: 'session-1' },
        capabilities: { transcriptNavigation: 1, catalogSnapshot: 1, nativeHistoryViewport: 1, frameObservation: 1 }
      } })
      expect(received.find(item => item.body.kind === 'catalogPage')?.body.turns).toEqual([
        { entryId: 'entry-1', ordinal: 1, preview: 'Find the first question', createdAt: 100 }
      ])
      expect(received.find(item => item.body.kind === 'applied')?.body).toEqual({ kind: 'applied', requestId: 'request-1', admissionId: 'admission-1',
        position: { mode: 'browsing', sessionId: 'session-1', branchEpoch: 4, displayEpoch: 7, viewRevision: 2,
          frameId: 'frame-target', entryId: 'entry-1', anchor: { partId: 'entry-1:user', scalarOffset: 0 } }
      })
      expect(received.filter(item => item.path !== '/omp/register').every(item => item.auth === 'Bearer lease-1')).toBe(true)
    } finally {
      bridge.stop()
      await bridge.done
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('does not execute an accepted command when its scope is revoked before final authorization', async () => {
    let delivered = false
    let scopeRevoked = false
    let authorizationDenied = false
    let nativeExecutions = 0
    let releaseAccept: () => void = () => {}
    let signalAccept: () => void = () => {}
    let finish: () => void = () => {}
    const acceptGate = new Promise<void>(resolve => { releaseAccept = resolve })
    const acceptReached = new Promise<void>(resolve => { signalAccept = resolve })
    const completed = new Promise<void>(resolve => { finish = resolve })
    const authorizations: unknown[] = []
    const terminalEvents: unknown[] = []
    const server = createServer(async (request, response) => {
      let raw = ''
      for await (const chunk of request) raw += chunk
      const body: Record<string, unknown> = JSON.parse(raw)
      response.setHeader('Content-Type', 'application/json')
      if (request.url === '/omp/register') response.end('{"leaseToken":"stable-lease"}')
      else if (request.url === '/omp/poll') {
        if (!delivered) {
          delivered = true
          response.end(JSON.stringify({ command: { requestId: 'request-old-scope', seq: 1, scopeId: 'old-scope', controlEpoch: 1, sessionId: 'session-1', branchEpoch: 1, displayEpoch: 1, remainingAdmissionTtlMs: 4900, target: { kind: 'turn', entryId: 'entry-1' } } }))
        } else {
          setTimeout(() => response.end('{"command":null}'), 30)
          if (authorizationDenied) finish()
        }
      } else if (request.url === '/omp/accept') {
        signalAccept()
        await acceptGate
        response.end('{"admission":{"requestId":"request-old-scope","admissionId":"old-admission","executionBudgetMs":5000}}')
      } else if (request.url === '/omp/authorize') {
        authorizations.push(body)
        if (scopeRevoked) {
          authorizationDenied = true
          response.statusCode = 409
          response.end('{"error":"superseded"}')
        } else response.end('{"authorized":true,"executionBudgetMs":5000}')
      } else {
        if (body.kind === 'applied' || body.kind === 'failed' || body.kind === 'abandoned') terminalEvents.push(body)
        response.end('{"ok":true}')
      }
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('missing test listener')
    const position = { mode: 'live' as const, sessionId: 'session-1', branchEpoch: 1, displayEpoch: 1, viewRevision: 1, frameId: 'live' }
    const bridge = startNavigationBridge({ baseUrl: `http://127.0.0.1:${address.port}`, paneId: 'pane-1', secret: 'secret-1',
      origin: () => ({ processId: 20, sequence: 2, emittedAt: 100, instanceId: 'instance-1', conversationId: 'session-1' }),
      onSession: async () => {},
      transcript: {
        getCapabilities: () => ({ transcriptNavigation: 1, catalogSnapshot: 1, nativeHistoryViewport: 1, frameObservation: 1 }),
        getPosition: () => position,
        getCatalog: () => ({ sessionId: 'session-1', branchEpoch: 1, catalogRevision: 1, turns: [{ entryId: 'entry-1', summary: 'Question', timestamp: 100 }] }),
        seek: async () => { nativeExecutions++; return position },
        returnToLive: async () => { nativeExecutions++; return position },
        onPosition: () => () => {}, onCatalog: () => () => {}
      }
    })
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await acceptReached
      scopeRevoked = true
      releaseAccept()
      await Promise.race([completed, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('revoked scope was not reauthorized')), 3000) })])
      expect(authorizations).toEqual([{ requestId: 'request-old-scope', admissionId: 'old-admission' }])
      expect(nativeExecutions).toBe(0)
      expect(terminalEvents).toEqual([{ kind: 'abandoned', requestId: 'request-old-scope', admissionId: 'old-admission' }])
    } finally {
      clearTimeout(timeout)
      releaseAccept()
      bridge.stop()
      await bridge.done
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
