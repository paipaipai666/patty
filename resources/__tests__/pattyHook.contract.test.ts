
   
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { isCanonicalEvent } from './hookProtocol'

const SCRIPT = resolve(__dirname, '..', 'patty-hook.ps1')

let server: Server
let port: number
let inbox: Array<{ paneId?: string; event?: string; source?: string; secret?: string }>
let waiter: ((value: unknown) => void) | null = null


function nextPost(): Promise<unknown> {
  return new Promise((resolvePromise) => {
    waiter = resolvePromise
  })
}

beforeAll(async () => {
  inbox = []
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      inbox.push(JSON.parse(raw))
      waiter?.(null)
      waiter = null
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server address')
  port = address.port

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const warmup = spawn('powershell.exe', ['-NoProfile', '-Command', '$null'], {
      stdio: 'ignore',
    })
    warmup.on('exit', () => resolvePromise())
    warmup.on('error', (err) => rejectPromise(err))
  })
})

afterAll(async () => {
  await new Promise((resolvePromise) => server.close(resolvePromise))
})


   
async function runHook(stdinPayload: string, extraArgs: string[] = []): Promise<{
  paneId?: string
  event?: string
  source?: string
  secret?: string
}> {
  inbox = []
  const posted = nextPost()
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...extraArgs],
    {
      env: {
        ...process.env,
        PATTY_PANE_ID: 'pane-1',
        PATTY_PORT: String(port),
        PATTY_HOOK_SECRET: 'secret-1'
      },
      stdio: ['pipe', 'ignore', 'ignore']
    }
  )
  child.stdin.write(stdinPayload)
  child.stdin.end()

  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => {

      child.kill()
      reject(new Error(`no POST received for payload: ${stdinPayload}`))
    }, 10_000)
  })
  await Promise.race([posted, timeout])

  expect(isCanonicalEvent(inbox[0]?.event), inbox[0]?.event).toBe(true)
  return inbox[0]
}


const T = { timeout: 20_000 }

describe('patty-hook.ps1 contract', () => {
  it('Claude 1.x Notification: notification_type permission_prompt', T, async () => {
    const body = await runHook(JSON.stringify({ notification_type: 'permission_prompt' }))
    expect(body).toEqual({ paneId: 'pane-1', event: 'permission_prompt', source: 'claude-code', secret: 'secret-1' })
  })

  it('Claude 1.x Notification: idle_prompt passes through', T, async () => {
    const body = await runHook(JSON.stringify({ notification_type: 'idle_prompt' }))
    expect(body.event).toBe('idle_prompt')
  })

  it('Claude 1.x SessionEnd: reason field → session_end', T, async () => {
    const body = await runHook(JSON.stringify({ reason: 'clear' }))
    expect(body.event).toBe('session_end')
  })

  it('Claude 1.x StopFailure: type field → error_<type>', T, async () => {
    const body = await runHook(JSON.stringify({ type: 'rate_limit' }))
    expect(body.event).toBe('error_rate_limit')
  })

  it('Claude 1.x StopFailure: error_type fallback → error_<type>', T, async () => {
    const body = await runHook(JSON.stringify({ error_type: 'overloaded' }))
    expect(body.event).toBe('error_overloaded')
  })

  it('Claude 2.x Notification: hook_event_name + notification_type wins', T, async () => {

    const body = await runHook(JSON.stringify({ hook_event_name: 'Notification', notification_type: 'permission_prompt' }))
    expect(body.event).toBe('permission_prompt')
  })

  it('Claude 2.x Notification without subtype falls back to message match', T, async () => {
    const body = await runHook(JSON.stringify({ hook_event_name: 'Notification', message: 'Claude needs your permission for a tool' }))
    expect(body.event).toBe('permission_prompt')
  })

  it('Claude 2.x StopFailure: reads type subfield', T, async () => {
    const body = await runHook(JSON.stringify({ hook_event_name: 'StopFailure', type: 'rate_limit' }))
    expect(body.event).toBe('error_rate_limit')
  })

  it('Claude 2.x StopFailure: reads error_type subfield', T, async () => {
    const body = await runHook(JSON.stringify({ hook_event_name: 'StopFailure', error_type: 'server_error' }))
    expect(body.event).toBe('error_server_error')
  })

  it('Claude SessionStart: hook_event_name → session_start', T, async () => {
    const body = await runHook(JSON.stringify({ hook_event_name: 'SessionStart' }))
    expect(body.event).toBe('session_start')
  })

  it('Codex PermissionRequest → permission_prompt with source codex', T, async () => {
    const body = await runHook(JSON.stringify({ hook_event_name: 'PermissionRequest' }), ['-Source', 'codex'])
    expect(body).toEqual({ paneId: 'pane-1', event: 'permission_prompt', source: 'codex', secret: 'secret-1' })
  })

  it('Codex Stop → stop with source codex', T, async () => {
    const body = await runHook(JSON.stringify({ hook_event_name: 'Stop' }), ['-Source', 'codex'])
    expect(body).toEqual(expect.objectContaining({ event: 'stop', source: 'codex' }))
  })

  it('Codex PascalCase lifecycle events normalize to canonical names', T, async () => {

    for (const [hookName, event] of [
      ['PreToolUse', 'pre_tool_use'],
      ['PostToolUse', 'post_tool_use'],
      ['UserPromptSubmit', 'user_prompt_submit']
    ] as const) {
      const body = await runHook(JSON.stringify({ hook_event_name: hookName }), ['-Source', 'codex'])
      expect(body.event).toBe(event)
    }
  })

  it('Qwen SessionStart → session_start with source qwen-code', T, async () => {
    const body = await runHook(JSON.stringify({ hook_event_name: 'SessionStart' }), ['-Source', 'qwen-code'])
    expect(body).toEqual({ paneId: 'pane-1', event: 'session_start', source: 'qwen-code', secret: 'secret-1' })
  })

  it('Qwen PermissionRequest → permission_prompt', T, async () => {
    const body = await runHook(JSON.stringify({ hook_event_name: 'PermissionRequest' }), ['-Source', 'qwen-code'])
    expect(body.event).toBe('permission_prompt')
    expect(body.source).toBe('qwen-code')
  })

  it('Copilot camelCase agentStop → stop with source copilot-cli', T, async () => {
    const body = await runHook(JSON.stringify({ hook_event_name: 'agentStop' }), ['-Source', 'copilot-cli'])
    expect(body).toEqual({ paneId: 'pane-1', event: 'stop', source: 'copilot-cli', secret: 'secret-1' })
  })

  it('Copilot camelCase sessionEnd → session_end', T, async () => {
    const body = await runHook(JSON.stringify({ hook_event_name: 'sessionEnd' }), ['-Source', 'copilot-cli'])
    expect(body.event).toBe('session_end')
  })

  it('Copilot camelCase preToolUse → pre_tool_use', T, async () => {
    const body = await runHook(JSON.stringify({ hook_event_name: 'preToolUse' }), ['-Source', 'copilot-cli'])
    expect(body.event).toBe('pre_tool_use')
  })

  it('Copilot errorOccurred → error', T, async () => {
    const body = await runHook(JSON.stringify({ hook_event_name: 'errorOccurred' }), ['-Source', 'copilot-cli'])
    expect(body.event).toBe('error')
  })

  it('empty stdin → stop', T, async () => {
    const body = await runHook('')
    expect(body.event).toBe('stop')
  })

  it('unparseable stdin → stop (never crashes the hook)', T, async () => {
    const body = await runHook('this is not json')
    expect(body.event).toBe('stop')
  })
})
