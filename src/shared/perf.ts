/**
 * Lightweight performance instrumentation, gated behind PATTY_PERF=1.
 * Zero overhead in production — all functions are no-ops when the env var is unset.
 */

const enabled =
  (typeof window !== 'undefined' && window.terminalAPI?.perfEnabled === true) ||
  (typeof process !== 'undefined' && process.env?.PATTY_PERF === '1')

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
  console.log(`[perf] ${name}: ${elapsed.toFixed(2)}ms`)
  return elapsed
}

export { enabled as perfEnabled }
