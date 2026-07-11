/**
 * Lightweight performance instrumentation, gated behind PATTY_PERF=1.
 * Zero overhead in production — all functions are no-ops when the env var is unset.
 */

const enabled = typeof process !== 'undefined' && process.env?.PATTY_PERF === '1'

// ── Log Collection (for benchmark script) ─────────────────────────────────

const allLogs: string[] = []
const PERF_DUMP_PATH = typeof process !== 'undefined'
  ? (process.env.PATTY_PERF_DUMP || '') : ''

function log(msg: string): void {
  console.log(msg)
  if (enabled) allLogs.push(msg)
}

export function perfDump(): void {
  if (!enabled || !PERF_DUMP_PATH) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as typeof import('fs')
    const data = {
      timestamp: new Date().toISOString(),
      metrics: collectMetrics(),
      logs: allLogs
    }
    fs.writeFileSync(PERF_DUMP_PATH, JSON.stringify(data, null, 2), 'utf-8')
    log(`[perf] dumped to ${PERF_DUMP_PATH}`)
  } catch (e) {
    console.error('[perf] dump failed:', e)
  }
}

function collectMetrics(): Record<string, number> {
  const m: Record<string, number> = {}
  for (const line of allLogs) {
    const t = line.match(/\[perf\]\s+(.+?):\s+([\d.]+)ms/)
    if (t) m[t[1]] = parseFloat(t[2])
    const r = line.match(/\[perf\]\s+(.+?)\s+rate:\s+([\d.]+)\/s/)
    if (r) m[`rate:${r[1]}`] = parseFloat(r[2])
  }
  for (const [k, v] of counters) m[`counter:${k}`] = v
  return m
}

// ── Counters ──────────────────────────────────────────────────────────────

const counters = new Map<string, number>()
const rateWindows = new Map<string, { count: number; windowStart: number }>()

export function perfCounter(name: string): void {
  if (!enabled) return
  counters.set(name, (counters.get(name) ?? 0) + 1)

  // Track per-second burst rate
  const now = Date.now()
  const win = rateWindows.get(name)
  if (!win || now - win.windowStart >= 1000) {
    if (win) {
      const elapsed = (now - win.windowStart) / 1000
      log(`[perf] ${name} rate: ${(win.count / elapsed).toFixed(1)}/s`)
    }
    rateWindows.set(name, { count: 1, windowStart: now })
  } else {
    win.count++
  }
}

// ── Timers ────────────────────────────────────────────────────────────────

const timers = new Map<string, number>()

export function perfTimerStart(name: string): void {
  if (!enabled) return
  timers.set(name, Date.now())
}

export function perfTimerEnd(name: string): number {
  if (!enabled) return 0
  const start = timers.get(name)
  if (start === undefined) return 0
  const elapsed = Date.now() - start
  log(`[perf] ${name}: ${elapsed.toFixed(2)}ms`)
  timers.delete(name)
  return elapsed
}

// ── Marks / Measures (Date.now based, more reliable in Electron) ──────────

const marks = new Map<string, number>()

export function perfMark(name: string): void {
  if (!enabled) return
  marks.set(name, Date.now())
}

export function perfMeasure(name: string, startMark: string): number {
  if (!enabled) return 0
  const start = marks.get(startMark)
  if (start === undefined) return 0
  const elapsed = Date.now() - start
  log(`[perf] ${name}: ${elapsed.toFixed(2)}ms`)
  return elapsed
}

// ── Memory ────────────────────────────────────────────────────────────────

export function perfMemoryMain(label: string): void {
  if (!enabled) return
  const mem = process.memoryUsage()
  const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)
  log(
    `[perf] memory[${label}] rss=${mb(mem.rss)}MB heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB external=${mb(mem.external)}MB`
  )
}

// ── Report ────────────────────────────────────────────────────────────────

export function perfReport(): void {
  if (!enabled) return
  log('[perf] ── Counters ──')
  Array.from(counters.entries()).forEach(([name, count]) => {
    log(`[perf]   ${name}: ${count}`)
  })
  log('[perf] ── End ──')
}

export { enabled as perfEnabled }
