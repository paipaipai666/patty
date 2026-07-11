export interface MetricSample {
  timestamp: number
  appCpu: number
  systemCpu: number
  appMemMB: number
  systemMemUsedMB: number
  systemMemTotalMB: number
  gpuUtil: number | null
  gpuMemMB: number
  gpuProxy: boolean
}

export interface FirstTerminalEntry {
  iso: string
  shell: string
  durationMs: number
}

export interface MetricsSnapshot {
  firstTerminal: FirstTerminalEntry[]
  samples: MetricSample[]
}

export interface MetricsHistory {
  version: number
  firstTerminal: FirstTerminalEntry[]
  samples: MetricSample[]
}
