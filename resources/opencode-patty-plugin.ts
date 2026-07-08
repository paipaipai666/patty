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

export const PattyNotifier = async ({ project, directory, $ }) => {
  const PATTY_PORT = process.env.PATTY_PORT
  const PANE_ID = process.env.PATTY_PANE_ID

  // 不在 Patty 环境中，静默退出
  if (!PATTY_PORT || !PANE_ID) {
    return {}
  }

  let aliveInterval: ReturnType<typeof setInterval> | null = null

  const notifyPatty = async (event: string) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1500)
    try {
      await fetch(`http://127.0.0.1:${PATTY_PORT}/hook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paneId: PANE_ID, event, source: 'opencode' }),
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
        case 'session.created':
          await notifyPatty('session_created')
          if (aliveInterval) clearInterval(aliveInterval)
          aliveInterval = setInterval(() => notifyPatty('alive'), 5000)
          if (aliveInterval && typeof aliveInterval === 'object' && 'unref' in aliveInterval) {
            ;(aliveInterval as any).unref()
          }
          break

        case 'session.deleted':
          if (aliveInterval) {
            clearInterval(aliveInterval)
            aliveInterval = null
          }
          await notifyPatty('session_deleted')
          break

        case 'permission.asked':
        case 'question.asked':
          await notifyPatty('permission_prompt')
          break

        // permission.replied 和 question.replied 不触发通知
        // 因为用户回复后 agent 还在处理，只有 session.idle 才表示真正完成

        case 'session.idle':
          await notifyPatty('idle')
          break

        case 'session.error':
          await notifyPatty('error')
          break
      }
    }
  }
}
