/**
 * 共享 hook 词汇表助手 —— 单一事实源是 resources/hook-protocol.json，
 * Rust 后端的一致性测试（hooks.rs）与这里的适配器契约测试共同消费。
 * 任一侧漂移都会红测试，而不是让指示灯静默熄灭。
 */
import { readFileSync } from 'node:fs'

interface Protocol {
  sources: string[]
  events: Record<string, string | null>
  patterns: Array<{ prefix?: string; contains?: string; attention: string }>
}

export const protocol: Protocol = JSON.parse(
  readFileSync(new URL('../hook-protocol.json', import.meta.url), 'utf8')
)

/** 事件名是否在规范词汇内：闭集成员，或命中某条开放 pattern。 */
export function isCanonicalEvent(event: string | undefined): boolean {
  if (!event) return false
  if (event in protocol.events) return true
  return protocol.patterns.some(
    (p) => (p.prefix !== undefined && event.startsWith(p.prefix)) ||
      (p.contains !== undefined && event.includes(p.contains))
  )
}
