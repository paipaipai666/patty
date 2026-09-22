
   
import http from 'node:http'
import WebSocket from 'ws'

                                                                   
export async function waitForPageTarget(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const targets = await getJson(port, '/json/list')

      const page = targets.find((t) => t.type === 'page' && /^https?:\/\//.test(t.url))
      if (page) return page
    } catch (e) {
      lastError = e
    }
    await sleep(250)
  }
  throw new Error(
    `no debuggable page on 127.0.0.1:${port} within ${timeoutMs}ms` +
      (lastError ? ` (last error: ${lastError.message})` : '') +
      '. If another Patty instance is running, close it first: the single-instance plugin forwards and exits before the debug port opens.'
  )
}

function getJson(port, path) {
  return new Promise((resolvePromise, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path }, (res) => {
      let raw = ''
      res.on('data', (c) => (raw += c))
      res.on('end', () => {
        try {
          resolvePromise(JSON.parse(raw))
        } catch (e) {
          reject(e)
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(2000, () => req.destroy(new Error('http timeout')))
  })
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export class Cdp {
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl, { perMessageDeflate: false })
    await new Promise((resolvePromise, reject) => {
      ws.once('open', resolvePromise)
      ws.once('error', reject)
    })
    return new Cdp(ws)
  }

  constructor(ws) {
    this.ws = ws
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: resolvePromise, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(`${msg.error.message} (code ${msg.error.code})`))
        else resolvePromise(msg.result)
      } else if (msg.method) {
        for (const cb of this.listeners.get(msg.method) ?? []) cb(msg.params)
      }
    })
  }

                                                                   
  on(method, cb) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(cb)
  }

  send(method, params = {}, timeoutMs = 10_000) {
    const id = this.nextId++

    let settle
    const promise = new Promise((resolvePromise, reject) => {
      settle = { resolve: resolvePromise, reject }
    })

    const timer = setTimeout(() => {
      if (this.pending.delete(id)) {
        settle.reject(new Error(`CDP call timed out after ${timeoutMs}ms: ${method}`))
      }
    }, timeoutMs)
    this.pending.set(id, {
      resolve: (v) => { clearTimeout(timer); settle.resolve(v) },
      reject: (e) => { clearTimeout(timer); settle.reject(e) }
    })
    this.ws.send(JSON.stringify({ id, method, params }))
    return promise
  }


     
  async evaluate(expression, timeoutMs = 10_000) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    }, timeoutMs)
    if (result.exceptionDetails) {
      throw new Error(`page evaluation failed: ${JSON.stringify(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)}`)
    }
    return result.result.value
  }


     
  async waitFor(conditionExpr, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try {
        const found = await this.evaluate(`(async () => {
          const deadline = Date.now() + ${timeoutMs}
          while (Date.now() < deadline) {
            try { if (${conditionExpr}) return true } catch {}
            await new Promise(r => setTimeout(r, 200))
          }
          return false
        })()`, timeoutMs + 5_000)
        if (found) return
      } catch (e) {
        if (!/context was destroyed|Cannot find default execution context/i.test(e.message)) throw e
      }
      if (Date.now() > deadline) {
        throw new Error(`condition never became true within ${timeoutMs}ms: ${conditionExpr}`)
      }
      await sleep(300)
    }
  }

                                                                      
  insertText(text) {
    return this.send('Input.insertText', { text })
  }

  pressEnter() {
    return this.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13
    }).then(() =>
      this.send('Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13
      })
    )
  }

  close() {
    this.ws.close()
  }
}
