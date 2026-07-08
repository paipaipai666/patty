import * as fs from 'fs'
import * as path from 'path'
import { getHeartbeatConfig } from '../shared/heartbeat'

// 已知限制：claude-code / codex 在纯文本、无工具调用的超长回复期间不触发任何
// hook 事件，因此该场景火焰可能在回复结束前熄灭，并在下次 hook 事件自愈。最长
// 延迟 = 超时值（当前 10min）。这是设计上明确接受的 tradeoff，非 bug。

export interface ActiveEntry {
  source: string
  lastSeen: number
}

export const HEARTBEAT_TICK_MS = 5000
export const MIN_STATS_FLUSH_MS = 5 * 60 * 1000

const active = new Map<string, ActiveEntry>()
const maxNaturalGap: Record<string, number> = {}

let statsPath: string | null = null
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
  const gap = now - prev.lastSeen
  if (gap >= 0 && gap < cfg.timeoutMs) {
    maxNaturalGap[source] = Math.max(maxNaturalGap[source] ?? 0, gap)
  }
  active.set(paneId, { source, lastSeen: now })
}

export function removePane(paneId: string): void {
  active.delete(paneId)
}

export function snapshot(): Array<{ paneId: string } & ActiveEntry> {
  return Array.from(active.entries()).map(([paneId, e]) => ({ paneId, ...e }))
}

export function setStatsPath(p: string): void {
  statsPath = p
}

export function loadStats(): void {
  if (!statsPath) return
  try {
    if (fs.existsSync(statsPath)) {
      const data = JSON.parse(fs.readFileSync(statsPath, 'utf-8')) as {
        maxNaturalGap?: Record<string, number>
      }
      if (data.maxNaturalGap) {
        for (const [k, v] of Object.entries(data.maxNaturalGap)) {
          if (typeof v === 'number') {
            maxNaturalGap[k] = Math.max(maxNaturalGap[k] ?? 0, v)
          }
        }
      }
    }
  } catch {
    // corrupt or unreadable stats are non-fatal
  }
}

export function flushStats(): void {
  if (!statsPath) return
  try {
    fs.mkdirSync(path.dirname(statsPath), { recursive: true })
    fs.writeFileSync(statsPath, JSON.stringify({ maxNaturalGap, updatedAt: Date.now() }), 'utf-8')
  } catch {
    // write errors are non-fatal
  }
}

export function startHeartbeatWatchdog(
  sendClear: (paneId: string) => void,
  opts?: { statsIntervalMs?: number }
): () => void {
  if (stopWatchdog) stopWatchdog()
  loadStats()

  const tick = () => {
    const now = Date.now()
    const expired = collectExpired(active, now)
    for (const id of expired) {
      const entry = active.get(id)
      // defensive re-check: single-threaded model has no real race, but async
      // hook handlers can arrive out of order and must converge here.
      if (entry && now - entry.lastSeen > getHeartbeatConfig(entry.source)!.timeoutMs) {
        sendClear(id)
        active.delete(id)
      }
    }
  }

  const timer = setInterval(tick, HEARTBEAT_TICK_MS)
  const statsIntervalMs =
    opts?.statsIntervalMs && opts.statsIntervalMs >= MIN_STATS_FLUSH_MS
      ? opts.statsIntervalMs
      : MIN_STATS_FLUSH_MS
  const statsTimer = setInterval(() => flushStats(), statsIntervalMs)

  stopWatchdog = () => {
    clearInterval(timer)
    clearInterval(statsTimer)
    stopWatchdog = null
  }
  return stopWatchdog
}
