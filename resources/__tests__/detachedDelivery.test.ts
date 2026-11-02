import { createServer } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnvironment = { port: process.env.PATTY_PORT, pane: process.env.PATTY_PANE_ID, secret: process.env.PATTY_HOOK_SECRET }
const originalExitListeners = new Set(process.listeners('exit'))

afterEach(() => {
  for (const [key, value] of Object.entries({ PATTY_PORT: originalEnvironment.port, PATTY_PANE_ID: originalEnvironment.pane, PATTY_HOOK_SECRET: originalEnvironment.secret })) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  for (const listener of process.listeners('exit')) if (!originalExitListeners.has(listener)) process.removeListener('exit', listener)
})

async function verifyDelivery(source: 'omp' | 'opencode', publish: () => Promise<void>) {
  const bodies: unknown[] = []
  const server = createServer((request, response) => {
    let raw = ''
    request.on('data', (chunk) => { raw += chunk })
    request.on('end', () => {
      if (raw) bodies.push(JSON.parse(raw))
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{"ok":true}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server port')
  process.env.PATTY_PORT = String(address.port)
  process.env.PATTY_PANE_ID = 'delivery-pane'
  process.env.PATTY_HOOK_SECRET = 'delivery-test-secret'
  try {
    await publish()
    await vi.waitFor(() => expect(bodies).toContainEqual(expect.objectContaining({
      paneId: 'delivery-pane', event: 'session_deleted', source, secret: 'delivery-test-secret',
      origin: expect.objectContaining({ processId: process.pid, sequence: 2, emittedAt: expect.any(Number), instanceId: expect.any(String) })
    })), { timeout: 4500 })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

describe('detached hook transport', () => {
  it('delivers the omp shutdown body through a real curl process', async () => {
    await verifyDelivery('omp', async () => {
      const { default: notifier } = await import('../omp-patty-hook')
      const handlers = new Map<string, (event: unknown, context: { setInterval: (fn: () => void, ms: number) => void }) => unknown>()
      notifier({ on: (name, handler) => { handlers.set(name, handler) } })
      const context = { setInterval: () => {} }
      await handlers.get('session_start')?.({}, context)
      handlers.get('session_shutdown')?.({}, context)
    })
  })

  it('delivers the OpenCode session end body through a real curl process', async () => {
    await verifyDelivery('opencode', async () => {
      const { default: plugin } = await import('../opencode-patty-plugin')
      const hooks = await plugin.server()
      if (!hooks.event) throw new Error('Missing OpenCode event handler')
      await hooks.event({ event: { type: 'session.created', data: { sessionID: 'chat-a' } } })
      await hooks.event({ event: { type: 'session.deleted', data: { sessionID: 'chat-a' } } })
    })
  })
})
