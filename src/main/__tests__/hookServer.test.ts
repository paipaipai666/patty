import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'http'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: { isPackaged: false, getAppPath: () => '/app' }
}))
vi.mock('../heartbeat', () => ({ removePane: vi.fn() }))

import { startHookServer, stopHookServer } from '../ptyManager'

function post(port: number, body: unknown, secret?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(data))
    }
    if (secret) headers['x-patty-secret'] = secret
    const req = http.request(
      { host: '127.0.0.1', port, path: '/hook', method: 'POST', headers },
      (res) => {
        let out = ''
        res.on('data', (c) => (out += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: out }))
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

describe('hook server auth (M6)', () => {
  let port = 0

  beforeEach(async () => {
    port = await startHookServer(() => {})
  })
  afterEach(() => {
    stopHookServer()
  })

  it('rejects a hook POST that carries no shared secret', async () => {
    const res = await post(port, { paneId: 'x', event: 'session_start' })
    // DESIRED: unauthenticated hook calls are refused. Currently the server
    // has no auth, so it returns 200 — this fails.
    expect(res.status).toBe(401)
  })
})
