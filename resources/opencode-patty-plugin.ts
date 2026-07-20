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

  const mainSessions = new Set<string>()
  let aliveInterval: ReturnType<typeof setInterval> | null = null

  const notifyPatty = async (event: string) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1500)
    try {
      await fetch(`http://127.0.0.1:${PATTY_PORT}/hook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paneId: PANE_ID,
          event,
          source: 'opencode',
          // The hook server rejects unauthenticated callers (401); the secret
          // is injected into the terminal env by Patty's pty layer.
          secret: process.env.PATTY_HOOK_SECRET
        }),
        signal: controller.signal
      })
    } catch {
      // 静默忽略网络错误
    } finally {
      clearTimeout(timeoutId)
    }
  }

  return {
    event: async ({ event }) => {
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
          if (aliveInterval) {
            clearInterval(aliveInterval)
            aliveInterval = null
          }
          await notifyPatty('session_deleted')
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
          if (sessionID && !mainSessions.has(sessionID)) break
          await notifyPatty('idle')
          break
        }

        case 'session.status': {
          const sessionID = (event as any)?.properties?.sessionID
          const status = (event as any)?.properties?.status
          if (status?.type === 'idle' && sessionID && !mainSessions.has(sessionID)) {
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
