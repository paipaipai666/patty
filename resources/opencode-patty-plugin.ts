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

  const notifyPatty = async (event: string) => {
    try {
      await fetch(`http://127.0.0.1:${PATTY_PORT}/hook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paneId: PANE_ID, event, source: 'opencode' })
      })
    } catch {
      // 静默忽略网络错误
    }
  }

  return {
    event: async ({ event }) => {
      switch (event.type) {
        case 'permission.asked':
        case 'question.asked':
          await notifyPatty('permission_prompt')
          break

        case 'permission.replied':
        case 'question.replied':
          await notifyPatty('idle')
          break

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
