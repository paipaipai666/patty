import type { Terminal } from '@xterm/xterm'

export interface Osc7HandlerDisposable {
  dispose(): void
}

export function registerOsc7Handler(
  term: Terminal,
  sessionId: string,
  onCwd: (sessionId: string, cwd: string) => void
): Osc7HandlerDisposable {
  const disposable = term.parser.registerOscHandler(7, (data) => {
    const cwd = normalizeCwdFromOsc(data)
    if (cwd) {
      onCwd(sessionId, cwd)
    }
    return true
  })

  return {
    dispose: () => disposable.dispose()
  }
}

/**
 * 从 OSC 7 payload 中提取当前目录路径。
 *
 * 输入格式: file://hostname/path
 * 示例:
 *   file://MY-PC/C:/Users/foo       -> C:\Users\foo
 *   file://MY-PC/C:/Program%20Files -> C:\Program Files
 *
 * 已知限制（已记录，不做特殊处理）:
 * - cmd 的 $P 不做 URL 编码。decodeURIComponent 对没有 % 前缀的路径是幂等的，
 *   但如果目录名恰好包含形如 %2F 的字面字符（如文件夹就叫 "report%20final"），
 *   会误解码为 "report/final"。此概率极低，且影响仅限单次保存的 cwd 路径与实际
 *   磁盘路径不一致，不影响功能完整性。
 */
function normalizeCwdFromOsc(data: string): string | null {
  const raw = data.replace(/^file:\/\/[^/\\]*[/\\]?/, '')
  if (!raw) return null
  try {
    const decoded = decodeURIComponent(raw).replace(/\//g, '\\')
    return decoded || null
  } catch {
    const fallback = raw.replace(/\//g, '\\')
    return fallback || null
  }
}
