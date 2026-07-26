/**
 * Oh My Pi Extension: Patty Notifier
 *
 * Patty 安装到 ~/.omp/agent/extensions/patty-notifier.ts；omp 启动时作为
 * extension module 自动加载（user-level 发现，无需改 config.yml）。
 * 事件语义与 resources/opencode-patty-plugin.ts 对齐：
 * - session_created:  omp 会话启动（session_start）
 * - alive:            每 5s 心跳 + 每次 tool_call（Patty 侧 8s 租约）
 * - idle:             主 session 回答完毕（session_stop；subagent 不触发）
 * - permission_prompt: 工具审批弹窗（tool_approval_requested）
 * - error_retry:      provider 自动重试开始（auto_retry_start）
 * - session_deleted:  omp 退出（session_shutdown，detached curl 投递）
 */

import { spawn } from 'node:child_process'

// omp extension API 的最小类型面（自包含文件，不 import omp 包）；
// 事件 payload 本模块不消费，统一 unknown。
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

  // 不在 Patty 终端内：完全惰性
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
      // 静默忽略网络错误
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // 进程退出时 fire-and-forget 的 fetch 来不及完成。用 detached 子进程投递
  // session_deleted；spawn 失败回退普通 fetch（Patty 看门狗 8s 兜底）。
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
      // omp 托管定时器：异常隔离、unref'd、session_shutdown 自动清理；
      // 不要用裸 setInterval（未捕获异常会拖垮整个 omp 会话）。
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
