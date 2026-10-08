
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type SessionRole = 'main' | 'subagent'

type IntervalHandle = ReturnType<typeof setInterval>

interface OpaqueEvent {
  type: string
  properties?: unknown
  [key: string]: unknown
}

interface SessionPayload {
  sessionID?: string
  parentID?: string
  status?: { type?: string }
}

interface PluginContext {
  event: {
    subscribe: (input: { signal: AbortSignal }) => AsyncIterable<OpaqueEvent>
  }
}

const active = () => Boolean(process.env.PATTY_PORT && process.env.PATTY_PANE_ID)

const LOG_FILE = join(tmpdir(), 'patty-opencode-hook.log')
const log = (msg: string) => {
  try {
    appendFileSync(LOG_FILE, `${new Date().toISOString()} [pid ${process.pid}] [pane ${process.env.PATTY_PANE_ID}] ${msg}\n`)
  } catch {

  }
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const payloadOf = (event: OpaqueEvent): SessionPayload => {
  const props = asRecord(event.properties) ?? asRecord(event.data) ?? asRecord(event) ?? {}
  const info = asRecord(props.info)
  const status = asRecord(props.status)
  return {
    sessionID: asString(info?.id) ?? asString(props.sessionID),
    parentID: asString(info?.parentID) ?? asString(props.parentID),
    status: status === undefined ? undefined : { type: asString(status.type) }
  }
}

const mainSessions = new Set<string>()
let aliveInterval: IntervalHandle | null = null

const hookBody = (event: string, role: SessionRole) =>
  JSON.stringify({
    paneId: process.env.PATTY_PANE_ID,
    event,
    source: 'opencode',
    role,

    secret: process.env.PATTY_HOOK_SECRET
  })

const notifyPatty = async (event: string, role: SessionRole = 'main') => {
  log(`→ patty: ${event} role=${role}`)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 1500)
  try {
    await fetch(`http://127.0.0.1:${process.env.PATTY_PORT}/hook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: hookBody(event, role),
      signal: controller.signal
    })
  } catch {

  } finally {
    clearTimeout(timeoutId)
  }
}

const notifyPattyDetached = (event: string, role: SessionRole = 'main') => {
  log(`→ patty (detached): ${event} role=${role}`)
  try {
    const child = spawn(
      'curl',
      ['-s', '-m', '3', '-X', 'POST', `http://127.0.0.1:${process.env.PATTY_PORT}/hook`, '-H', 'Content-Type: application/json', '-d', hookBody(event, role)],
      { detached: true, stdio: 'ignore' }
    )
    child.on('error', () => {})
    child.unref()
  } catch {
    void notifyPatty(event)
  }
}

const stopAlive = () => {
  if (aliveInterval) {
    clearInterval(aliveInterval)
    aliveInterval = null
  }
}

const startAlive = () => {
  stopAlive()
  aliveInterval = setInterval(() => void notifyPatty('alive'), 5000)
  if (typeof aliveInterval === 'object' && 'unref' in aliveInterval) {
    aliveInterval.unref()
  }
}

let exitHooked = false
const hookExit = () => {
  if (exitHooked) return
  exitHooked = true
  process.on('exit', () => {
    log('process exiting → session_deleted')
    notifyPattyDetached('session_deleted')
  })
}

const PRIMARY_KEY = '__pattyOpencodeNotifierPrimary'
const claimPrimary = (): boolean => {
  const g = globalThis as Record<string, unknown>
  if (g[PRIMARY_KEY]) return false
  g[PRIMARY_KEY] = true
  return true
}

const handleEvent = async (event: OpaqueEvent) => {
  if (!active()) return
  const { sessionID, parentID, status } = payloadOf(event)
  log(`opencode event: ${event.type}${sessionID ? ` session=${sessionID}` : ''}${parentID ? ` parent=${parentID}` : ''}`)
  switch (event.type) {
    case 'session.created': {
      const role: SessionRole = parentID ? 'subagent' : 'main'
      if (sessionID && !parentID) {
        mainSessions.add(sessionID)
      }

      await notifyPatty('session_created', role)
      hookExit()
      startAlive()
      break
    }

    case 'session.deleted': {
      if (sessionID) mainSessions.delete(sessionID)

      if (parentID) {
        log('ignored: subagent session.deleted')
        break
      }
      stopAlive()
      notifyPattyDetached('session_deleted')
      break
    }

    case 'permission.asked':
    case 'question.asked':
      await notifyPatty('permission_prompt')
      break

    case 'session.idle': {
      if (sessionID && !mainSessions.has(sessionID)) {
        log('ignored: session.idle from non-main session')
        break
      }
      await notifyPatty('idle')
      break
    }

    case 'session.status': {
      if (status?.type === 'idle' && sessionID && mainSessions.has(sessionID)) {
        await notifyPatty('idle')
      }
      break
    }

    case 'session.error':
    case 'session.execution.failed':
      await notifyPatty('error')
      break
  }
}

const plugin = {
  id: 'patty-notifier',

  async setup(ctx: PluginContext) {
    if (!active() || !claimPrimary()) return
    log('=== plugin active via v2 setup (opencode started inside Patty terminal) ===')
    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        await handleEvent(event)
      }
    })()
    return () => {
      controller.abort()
      stopAlive()
    }
  },

  async server() {
    if (!active()) return {}
    log('=== plugin active via v1 server() (opencode started inside Patty terminal) ===')
    return {
      event: async ({ event }: { event: OpaqueEvent }) => {
        await handleEvent(event)
      }
    }
  }
}

export default plugin
