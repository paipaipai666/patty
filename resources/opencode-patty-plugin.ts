
   

import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface PattyContext {
  project?: string
  directory?: string
  $?: unknown
}

interface PattyEvent {
  type: string
  properties?: Record<string, any>
}

interface PattyHook {
  event: (payload: { event: PattyEvent }) => Promise<void>
}

type SessionRole = 'main' | 'subagent'

export const PattyNotifier = async ({
  project: _project,
  directory: _directory,
  $: _$
}: PattyContext): Promise<PattyHook | Record<string, never>> => {
  const PATTY_PORT = process.env.PATTY_PORT
  const PANE_ID = process.env.PATTY_PANE_ID


  if (!PATTY_PORT || !PANE_ID) {
    return {}
  }


  const LOG_FILE = join(tmpdir(), 'patty-opencode-hook.log')
  const log = (msg: string) => {
    try {
      appendFileSync(LOG_FILE, `${new Date().toISOString()} [pid ${process.pid}] [pane ${PANE_ID}] ${msg}\n`)
    } catch {

    }
  }
  log('=== plugin active (opencode started inside Patty terminal) ===')

  const mainSessions = new Set<string>()
  let aliveInterval: ReturnType<typeof setInterval> | null = null

  const notifyPatty = async (event: string, role: SessionRole = 'main') => {
    log(`→ patty: ${event} role=${role}`)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1500)
    try {
      await fetch(`http://127.0.0.1:${PATTY_PORT}/hook`, {
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

  const hookBody = (event: string, role: SessionRole) =>
    JSON.stringify({
      paneId: PANE_ID,
      event,
      source: 'opencode',
      role,

      secret: process.env.PATTY_HOOK_SECRET
    })


  const notifyPattyDetached = (event: string, role: SessionRole = 'main') => {
    log(`→ patty (detached): ${event} role=${role}`)
    try {
      const child = spawn(
        'curl',
        ['-s', '-m', '3', '-X', 'POST', `http://127.0.0.1:${PATTY_PORT}/hook`, '-H', 'Content-Type: application/json', '-d', hookBody(event, role)],
        { detached: true, stdio: 'ignore' }
      )
      child.on('error', () => {})
      child.unref()
    } catch {
      void notifyPatty(event)
    }
  }


  process.on('exit', () => {
    log('process exiting → session_deleted')
    notifyPattyDetached('session_deleted')
  })

  return {
    event: async ({ event }) => {
      const props = (event as any)?.properties
      const sid = props?.info?.id ?? props?.sessionID
      const parentID = props?.info?.parentID
      log(`opencode event: ${event.type}${sid ? ` session=${sid}` : ''}${parentID ? ` parent=${parentID}` : ''}`)
      switch (event.type) {
        case 'session.created': {
          const info = (event as any)?.properties?.info
          const role: SessionRole = info?.parentID ? 'subagent' : 'main'
          if (info?.id && !info.parentID) {
            mainSessions.add(info.id)
          }

          await notifyPatty('session_created', role)
          if (aliveInterval) clearInterval(aliveInterval)
          aliveInterval = setInterval(() => notifyPatty('alive'), 5000)
          if (aliveInterval && typeof aliveInterval === 'object' && 'unref' in aliveInterval) {
            ;(aliveInterval as any).unref()
          }
          break
        }

        case 'session.deleted': {
          const info = (event as any)?.properties?.info
          if (info?.id) mainSessions.delete(info.id)

          if (info?.parentID) {
            log('ignored: subagent session.deleted')
            break
          }
          if (aliveInterval) {
            clearInterval(aliveInterval)
            aliveInterval = null
          }
          notifyPattyDetached('session_deleted')
          break
        }

        case 'permission.asked':
        case 'question.asked':
          await notifyPatty('permission_prompt')
          break




        case 'session.idle': {
          const sessionID = (event as any)?.properties?.sessionID
          if (sessionID && !mainSessions.has(sessionID)) {
            log('ignored: session.idle from non-main session')
            break
          }
          await notifyPatty('idle')
          break
        }

        case 'session.status': {
          const sessionID = (event as any)?.properties?.sessionID
          const status = (event as any)?.properties?.status
          if (status?.type === 'idle' && sessionID && mainSessions.has(sessionID)) {
            await notifyPatty('idle')
          }
          break
        }

        case 'session.error':
          await notifyPatty('error')
          break
      }
    }
  }
}
