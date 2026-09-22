
   

import { spawn } from 'node:child_process'


interface OmpExtensionContext {
  setInterval(fn: () => void, ms: number): void
}

interface OmpExtensionApi {
  on(event: string, handler: (event: unknown, ctx: OmpExtensionContext) => unknown): void
}

export default function PattyNotifier(pi: OmpExtensionApi): void {
  const PATTY_PORT = process.env.PATTY_PORT
  const PANE_ID = process.env.PATTY_PANE_ID
  const SECRET = process.env.PATTY_HOOK_SECRET


  if (!PATTY_PORT || !PANE_ID) return

  const hookBody = (event: string) =>
    JSON.stringify({ paneId: PANE_ID, event, source: 'omp', secret: SECRET })

  const notifyPatty = async (event: string) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1500)
    try {
      await fetch(`http://127.0.0.1:${PATTY_PORT}/hook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: hookBody(event),
        signal: controller.signal
      })
    } catch {

    } finally {
      clearTimeout(timeoutId)
    }
  }


  const notifyPattyDetached = (event: string) => {
    try {
      const child = spawn(
        'curl',
        ['-s', '-m', '3', '-X', 'POST', `http://127.0.0.1:${PATTY_PORT}/hook`, '-H', 'Content-Type: application/json', '-d', hookBody(event)],
        { detached: true, stdio: 'ignore' }
      )
      child.on('error', () => {})
      child.unref()
    } catch {
      void notifyPatty(event)
    }
  }

  let aliveStarted = false

  pi.on('session_start', async (_event: unknown, ctx: OmpExtensionContext) => {
    await notifyPatty('session_created')
    if (!aliveStarted) {
      aliveStarted = true

      ctx.setInterval(() => { void notifyPatty('alive') }, 5000)
    }
  })

  pi.on('session_shutdown', () => {
    notifyPattyDetached('session_deleted')
  })

  pi.on('session_stop', () => {
    void notifyPatty('idle')
  })

  pi.on('tool_call', () => {
    void notifyPatty('alive')
  })

  pi.on('tool_approval_requested', () => {
    void notifyPatty('permission_prompt')
  })

  pi.on('auto_retry_start', () => {
    void notifyPatty('error_retry')
  })
}
