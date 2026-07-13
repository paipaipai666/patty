import { app, type BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { cpus, totalmem, freemem } from 'os'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import type {
  MetricSample,
  FirstTerminalEntry,
  MetricsHistory,
  MetricsSnapshot
} from '../shared/metricsTypes'

// captureSample cost is dominated by two `Get-Counter` powershell.exe spawns.
// Measured on Windows: system-CPU counter ~535ms, GPU counter ~440ms, run in
// parallel via Promise.all → ~535ms wall. Keep the interval comfortably above
// that so samples never overlap (the `running` guard in sample() is a backstop
// for slower machines / counter contention). 2x measured cost.
export const METRICS_SAMPLE_COST_MS = 535
const SAMPLE_SAFETY_FACTOR = 2
export const SAMPLE_INTERVAL_MS = METRICS_SAMPLE_COST_MS * SAMPLE_SAFETY_FACTOR // 1070
const PERSIST_INTERVAL_MS = 10000
const MAX_SAMPLES = 120 // ~128s of history at the sample interval
const MAX_FIRST_TERMINALS = 30

const GPU_SCRIPT =
  `(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage').CounterSamples | ` +
  `Measure-Object -Property CookedValue -Sum | ` +
  `Select-Object -ExpandProperty Sum`

const SYSTEM_CPU_SCRIPT =
  `(Get-Counter '\\Processor(_Total)\\% Processor Time').CounterSamples[0].CookedValue`

interface CpuTotals {
  totals: number[]
  idles: number[]
}

interface GpuRealState {
  available: boolean
  pending: boolean
}

export class MetricsCollector {
  private getWindow: () => BrowserWindow | null
  private historyPath: string
  private samples: MetricSample[] = []
  private firstTerminal: FirstTerminalEntry[] = []
  private prevCpu: CpuTotals | null = null
  private gpuReal: GpuRealState = { available: true, pending: false }
  private gpuFailures = 0
  private sampleTimer: ReturnType<typeof setInterval> | null = null
  private persistTimer: ReturnType<typeof setInterval> | null = null
  private running = false

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow
    this.historyPath = join(app.getPath('userData'), 'metrics-history.json')
    this.load()
  }

  start(): void {
    if (this.sampleTimer) return
    this.sampleTimer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS)
    this.persistTimer = setInterval(() => this.persist(), PERSIST_INTERVAL_MS)
  }

  stop(): void {
    if (this.sampleTimer) {
      clearInterval(this.sampleTimer)
      this.sampleTimer = null
    }
    if (this.persistTimer) {
      clearInterval(this.persistTimer)
      this.persistTimer = null
    }
    this.persist()
  }

  getSnapshot(): MetricsSnapshot {
    return {
      firstTerminal: this.firstTerminal,
      samples: this.samples
    }
  }

  recordFirstTerminal(entry: FirstTerminalEntry): void {
    this.firstTerminal.push(entry)
    if (this.firstTerminal.length > MAX_FIRST_TERMINALS) {
      this.firstTerminal.shift()
    }
    console.log('[metrics] first terminal ready:', entry.shell, entry.durationMs, 'ms')
    this.persist()
  }

  private load(): void {
    if (!existsSync(this.historyPath)) return
    try {
      const raw = readFileSync(this.historyPath, 'utf-8')
      const parsed = JSON.parse(raw) as MetricsHistory
      if (parsed?.version === 1) {
        this.firstTerminal = (parsed.firstTerminal || []).slice(-MAX_FIRST_TERMINALS)
        this.samples = (parsed.samples || []).slice(-MAX_SAMPLES)
      }
    } catch (err) {
      console.error('[metrics] failed to load history:', err)
    }
  }

  persist(): void {
    try {
      const history: MetricsHistory = {
        version: 1,
        firstTerminal: this.firstTerminal.slice(-MAX_FIRST_TERMINALS),
        samples: this.samples.slice(-MAX_SAMPLES)
      }
      writeFileSync(this.historyPath, JSON.stringify(history), 'utf-8')
    } catch (err) {
      console.error('[metrics] failed to persist history:', err)
    }
  }

  private sample(): void {
    if (this.running) return
    this.running = true
    this.captureSample().finally(() => {
      this.running = false
    })
  }

  private async captureSample(): Promise<void> {
    const appMetrics = app.getAppMetrics()
    const gpu = appMetrics.find((m) => m.type === 'GPU')

    const appCpu = appMetrics.reduce((sum, m) => sum + (m.cpu?.percentCPUUsage ?? 0), 0)
    const appMemKB = appMetrics.reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0)
    const appMemMB = appMemKB / 1024

    const systemMemTotalMB = totalmem() / 1024 / 1024
    const systemMemUsedMB = (totalmem() - freemem()) / 1024 / 1024

    const [systemCpu, gpuUtil] = await Promise.all([
      this.sampleSystemCpuAsync(),
      this.sampleGpu()
    ])
    const gpuProxyMemKB = gpu?.memory?.workingSetSize ?? 0
    const gpuProxyMemMB = gpuProxyMemKB / 1024

    const gpuProxy = gpuUtil === null
    const gpuUtilValue = gpuUtil ?? 0
    const gpuMemMB = gpuProxyMemMB

    const sample: MetricSample = {
      timestamp: Date.now(),
      appCpu,
      systemCpu,
      appMemMB,
      systemMemUsedMB,
      systemMemTotalMB,
      gpuUtil: gpuProxy ? null : gpuUtilValue,
      gpuMemMB,
      gpuProxy
    }

    this.samples.push(sample)
    if (this.samples.length > MAX_SAMPLES) this.samples.shift()

    this.broadcast(sample)
  }

  private sampleSystemCpuAsync(): Promise<number> {
    return new Promise<number>((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', SYSTEM_CPU_SCRIPT],
        { windowsHide: true, timeout: 5000 },
        (err, stdout) => {
          if (err) {
            console.warn('[metrics] system CPU PDH failed, fallback to os.cpus():', err.message)
            resolve(this.sampleSystemCpu())
            return
          }
          const value = parseFloat(stdout.trim())
          if (Number.isNaN(value)) {
            resolve(this.sampleSystemCpu())
            return
          }
          resolve(value)
        }
      )
    })
  }

  private sampleSystemCpu(): number {
    const info = cpus()
    const totals = info.map((c) => c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq)
    const idles = info.map((c) => c.times.idle)

    if (!this.prevCpu) {
      this.prevCpu = { totals, idles }
      return 0
    }

    let totalUsage = 0
    let coreCount = 0
    for (let i = 0; i < totals.length; i++) {
      const totalDelta = totals[i] - this.prevCpu.totals[i]
      const idleDelta = idles[i] - this.prevCpu.idles[i]
      if (totalDelta > 0) {
        const usage = 100 * (1 - idleDelta / totalDelta)
        totalUsage += Math.max(0, Math.min(100, usage))
        coreCount++
      }
    }

    this.prevCpu = { totals, idles }
    return coreCount > 0 ? totalUsage / coreCount : 0
  }

  private sampleGpu(): Promise<number | null> {
    if (!this.gpuReal.available || this.gpuReal.pending) {
      return Promise.resolve(null)
    }
    this.gpuReal.pending = true

    return new Promise<number | null>((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', GPU_SCRIPT],
        { windowsHide: true, timeout: 5000 },
        (err, stdout, stderr) => {
          this.gpuReal.pending = false
          if (err) {
            this.gpuFailures++
            if (this.gpuFailures >= 3) {
              this.gpuReal.available = false
              console.warn(
                '[metrics] GPU real counter disabled after repeated failures. Last stderr:',
                stderr.trim() || '(empty)'
              )
            }
            resolve(null)
            return
          }
          this.gpuFailures = 0
          const value = parseFloat(stdout.trim())
          if (Number.isNaN(value)) {
            resolve(null)
            return
          }
          resolve(value)
        }
      )
    })
  }

  private broadcast(sample: MetricSample): void {
    const win = this.getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('metrics:tick', sample)
    }
  }
}
