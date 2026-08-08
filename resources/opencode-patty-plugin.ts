/**
 * OpenCode Plugin: Patty Notifier
 *
 * 监听 OpenCode 事件，当需要用户介入时发送通知到 Patty。
 * 支持的事件：
 * - permission.asked: 权限请求
 * - question.asked: 询问问题
 * - session.idle: 会话空闲（agent 完成回答）
 * - session.error: 执行出错
 */

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

export const PattyNotifier = async ({
  project: _project,
  directory: _directory,
  $: _$
}: PattyContext): Promise<PattyHook | Record<string, never>> => {
  const PATTY_PORT = process.env.PATTY_PORT
  const PANE_ID = process.env.PATTY_PANE_ID

  // 不在 Patty 环境中，静默退出
  if (!PATTY_PORT || !PANE_ID) {
    return {}
  }

  // 诊断日志：记录 opencode 实际发出的事件流与插件的处置，用于排查火焰
  // 状态卡死。文件在 %TEMP%\patty-opencode-hook.log（追加写，出错静默）。
  const LOG_FILE = join(tmpdir(), 'patty-opencode-hook.log')
  const log = (msg: string) => {
    try {
      appendFileSync(LOG_FILE, `${new Date().toISOString()} [pid ${process.pid}] [pane ${PANE_ID}] ${msg}\n`)
    } catch {
      // 日志失败不影响插件
    }
  }
  log('=== plugin active (opencode started inside Patty terminal) ===')

  const mainSessions = new Set<string>()
  let aliveInterval: ReturnType<typeof setInterval> | null = null

  const notifyPatty = async (event: string) => {
    log(`→ patty: ${event}`)
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
      // 静默忽略网络错误
    } finally {
      clearTimeout(timeoutId)
    }
  }

  const hookBody = (event: string) =>
    JSON.stringify({
      paneId: PANE_ID,
      event,
      source: 'opencode',
      // The hook server rejects unauthenticated callers (401); the secret
      // is injected into the terminal env by Patty's pty layer.
      secret: process.env.PATTY_HOOK_SECRET
    })

  // opencode 的 event dispatch 不 await 插件 handler，进程退出时 fire-and-forget
  // 的 fetch 来不及完成。用 detached 子进程投递 session_deleted，使其脱离本
  // 进程生命周期；spawn 失败时回退到普通 fetch（看门狗兜底）。
  const notifyPattyDetached = (event: string) => {
    log(`→ patty (detached): ${event}`)
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

  // opencode 1.18 退出时不再发射 session.deleted（插件日志实证：退出瞬间只有
  // 心跳中断，无任何会话事件）。改为监听进程退出——任何退出路径（正常退出、
  // Ctrl+C）都会同步触发 'exit'，在此用 detached curl 投递 session_deleted，
  // 使火焰立即熄灭；Patty 看门狗（8s 租约）仅作为投递失败时的兜底。
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
          if (info?.id && !info.parentID) {
            mainSessions.add(info.id)
          }
          await notifyPatty('session_created')
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
          // 子 agent session（带 parentID）的删除不代表顶层任务结束——与
          // session.idle 的 mainSessions 守卫同理。只有顶层 session 删除
          // 才停心跳并通知 Patty 清理火焰，否则主会话仍在运行时会被误清。
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

        // permission.replied 和 question.replied 不触发通知
        // 因为用户回复后 agent 还在处理，只有 session.idle 才表示真正完成

        // 子 agent 也会触发 session.idle / session.status(idle)，
        // 但只有顶层 session（无 parentID）结束才代表任务真正完成。
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
