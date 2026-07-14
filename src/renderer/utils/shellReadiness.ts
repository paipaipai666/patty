import type { FirstTerminalEntry } from '../../shared/metricsTypes'
import { perfMark, perfMeasure } from '../../shared/perf'

interface PendingStart {
  id: string
  shell: string
  startTime: number
}

let firstTerminalMeasured = false
let pendingStart: PendingStart | null = null

export function markTerminalOpen(id: string, shell: string): void {
  if (firstTerminalMeasured) return
  pendingStart = { id, shell, startTime: Date.now() }
  perfMark('terminal:mount')
}

export function markShellReady(id: string): void {
  if (firstTerminalMeasured) return
  if (!pendingStart || pendingStart.id !== id) return

  const duration = Date.now() - pendingStart.startTime
  const entry: FirstTerminalEntry = {
    iso: new Date().toISOString(),
    shell: pendingStart.shell,
    durationMs: duration
  }

  firstTerminalMeasured = true
  pendingStart = null

  perfMeasure('terminal:mount-to-osc7', 'terminal:mount')
  console.log(`[metrics] first terminal ready: ${entry.shell} ${entry.durationMs}ms`)
  window.terminalAPI.metricsRecordFirstTerminal(entry)
}
