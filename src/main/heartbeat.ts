import { getHeartbeatConfig } from '../shared/heartbeat'

// 已知限制：claude-code / codex 在纯文本、无工具调用的超长回复期间不触发任何
// hook 事件，因此该场景火焰可能在回复结束前熄灭，并在下次 hook 事件自愈。最长
// 延迟 = 超时值（当前 10min）。这是设计上明确接受的 tradeoff，非 bug。

export interface ActiveEntry {
  source: string
  lastSeen: number
}

export const HEARTBEAT_TICK_MS = 5000

const active = new Map<string, ActiveEntry>()

let stopWatchdog: (() => void) | null = null

export function collectExpired(activeMap: Map<string, ActiveEntry>, now: number): string[] {
  const expired: string[] = []
  for (const [id, entry] of activeMap) {
    const cfg = getHeartbeatConfig(entry.source)
    if (cfg && now - entry.lastSeen > cfg.timeoutMs) {
      expired.push(id)
    }
  }
  return expired
}

export function noteEvent(
  paneId: string,
  event: string,
  source: string,
  now: number = Date.now()
): void {
  const cfg = getHeartbeatConfig(source)
  if (!cfg) {
    console.warn(`[heartbeat] unknown source "${source}", ignoring event "${event}"`)
    return
  }
  if (event === 'session_start' || event === 'session_created') {
    active.set(paneId, { source, lastSeen: now })
    return
  }
  if (event === 'session_end' || event === 'session_deleted') {
    active.delete(paneId)
    return
  }
  const prev = active.get(paneId)
  if (!prev) return
  active.set(paneId, { source, lastSeen: now })
}

export function removePane(paneId: string): void {
  active.delete(paneId)
}

export function snapshot(): Array<{ paneId: string } & ActiveEntry> {
  return Array.from(active.entries()).map(([paneId, e]) => ({ paneId, ...e }))
}

export function startHeartbeatWatchdog(
  sendClear: (paneId: string) => void
): () => void {
  if (stopWatchdog) stopWatchdog()

  const tick = () => {
    const now = Date.now()
    const expired = collectExpired(active, now)
    for (const id of expired) {
      sendClear(id)
      active.delete(id)
    }
  }

  const timer = setInterval(tick, HEARTBEAT_TICK_MS)

  stopWatchdog = () => {
    clearInterval(timer)
    stopWatchdog = null
  }
  return stopWatchdog
}
