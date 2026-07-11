import { useEffect, useState } from 'react'
import styles from './MetricsDashboard.module.css'
import type { MetricSample, FirstTerminalEntry } from '../../../shared/metricsTypes'

const MAX_HISTORY_SAMPLES = 120

interface MetricsDashboardProps {
  open: boolean
  onClose: () => void
}

function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`
}

function formatMem(n: number): string {
  return `${n.toFixed(0)} MB`
}

function formatAxisValue(n: number, unit: string): string {
  return `${n.toFixed(n >= 100 ? 0 : 1)}${unit}`
}

function HistoryChart({
  series,
  width = 720,
  height = 120,
  maxY,
  unit = ''
}: {
  series: { data: number[]; color: string; label: string }[]
  width?: number
  height?: number
  maxY?: number
  unit?: string
}) {
  const axisWidth = 44
  const chartWidth = width - axisWidth

  if (series.some((s) => s.data.length < 2)) {
    return <svg viewBox={`0 0 ${width} ${height}`} className={styles.historyChart} />
  }

  const flat = series.flatMap((s) => s.data)
  const top = maxY ?? Math.max(1, ...flat)

  const paths = series.map((s) => {
    const points = s.data
      .map((v, i) => {
        const x = axisWidth + (i / (s.data.length - 1)) * chartWidth
        const y = height - (v / top) * height
        return `${x},${y}`
      })
      .join(' ')
    return { color: s.color, points, label: s.label }
  })

  const ticks = [
    { value: top, label: formatAxisValue(top, unit) },
    { value: top / 2, label: formatAxisValue(top / 2, unit) },
    { value: 0, label: formatAxisValue(0, unit) }
  ]

  return (
    <div className={styles.section}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.historyChart} overflow="visible">
        {ticks.map((t, i) => {
          const y = height - (t.value / top) * height
          return (
            <line
              key={`grid-${i}`}
              x1={axisWidth}
              y1={y}
              x2={width}
              y2={y}
              stroke="var(--border-subtle)"
              strokeWidth="1"
              strokeDasharray="2,2"
            />
          )
        })}
        <line
          x1={axisWidth}
          y1={0}
          x2={axisWidth}
          y2={height}
          stroke="var(--border-subtle)"
          strokeWidth="1"
        />
        {ticks.map((t, i) => {
          const y = height - (t.value / top) * height
          return (
            <text
              key={`label-${i}`}
              x={axisWidth - 6}
              y={y + 3}
              textAnchor="end"
              fontSize="9"
              fill="var(--text-muted)"
            >
              {t.label}
            </text>
          )
        })}
        {paths.map((p, i) => (
          <polyline key={i} fill="none" stroke={p.color} strokeWidth="2" points={p.points} />
        ))}
      </svg>
      <div className={styles.historyLegend}>
        {paths.map((p, i) => (
          <div key={i} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: p.color }} />
            <span>{p.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function MetricsDashboard({ open, onClose }: MetricsDashboardProps) {
  const [samples, setSamples] = useState<MetricSample[]>([])
  const [firstTerminal, setFirstTerminal] = useState<FirstTerminalEntry[]>([])

  useEffect(() => {
    if (!open) return
    let mounted = true
    window.terminalAPI.metricsHistory().then((snapshot) => {
      if (!mounted) return
      setSamples(snapshot.samples)
      setFirstTerminal(snapshot.firstTerminal)
    })
    const unsubscribe = window.terminalAPI.onMetricsTick((sample) => {
      setSamples((prev) => {
        const next = [...prev, sample]
        if (next.length > MAX_HISTORY_SAMPLES) next.shift()
        return next
      })
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [open])

  if (!open) return null

  const latest = samples[samples.length - 1]

  const avgFirst = firstTerminal.length
    ? firstTerminal.reduce((sum, e) => sum + e.durationMs, 0) / firstTerminal.length
    : 0
  const minFirst = firstTerminal.length ? Math.min(...firstTerminal.map((e) => e.durationMs)) : 0
  const maxFirst = firstTerminal.length ? Math.max(...firstTerminal.map((e) => e.durationMs)) : 0

  const hasGpuUtil = samples.some((s) => s.gpuUtil !== null)

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.dashboard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span>Performance</span>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.liveGrid}>
            <div className={styles.card}>
              <div className={styles.cardTitle}>CPU Load</div>
              <div className={styles.cardValue}>
                {latest ? formatPercent(latest.appCpu) : '--'}
              </div>
              <div className={styles.cardSub}>
                system {latest ? formatPercent(latest.systemCpu) : '--'} · % Processor Time
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>Memory</div>
              <div className={styles.cardValue}>
                {latest ? formatMem(latest.appMemMB) : '--'}
              </div>
              <div className={styles.cardSub}>
                system {latest ? formatMem(latest.systemMemUsedMB) : '--'} / total{' '}
                {latest ? formatMem(latest.systemMemTotalMB) : '--'}
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>GPU</div>
              <div className={styles.cardValue}>
                {latest ? formatMem(latest.gpuMemMB) : '--'}
              </div>
              <div className={styles.cardSub}>
                system-wide {latest ? (latest.gpuUtil !== null ? formatPercent(latest.gpuUtil) : '--') : '--'}
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>History</div>
            <HistoryChart
              series={[
                { data: samples.map((s) => s.systemCpu), color: 'var(--cyan)', label: 'System CPU load' },
                { data: samples.map((s) => s.appCpu), color: 'var(--amber)', label: 'App CPU load' }
              ]}
              maxY={100}
              unit="%"
            />
            <HistoryChart
              series={[
                { data: samples.map((s) => s.systemMemUsedMB), color: 'var(--green)', label: 'System memory' },
                { data: samples.map((s) => s.appMemMB), color: 'var(--amber)', label: 'App memory' }
              ]}
              unit="MB"
            />
            {hasGpuUtil ? (
              <HistoryChart
                series={[
                  {
                    data: samples.map((s) => s.gpuUtil ?? 0),
                    color: 'var(--indigo)',
                    label: 'GPU 3D (system-wide)'
                  }
                ]}
                maxY={100}
                unit="%"
              />
            ) : (
              <div className={styles.empty}>No real GPU utilization history yet (proxy mode).</div>
            )}
            <HistoryChart
              series={[
                {
                  data: samples.map((s) => s.gpuMemMB),
                    color: 'var(--indigo)',
                    label: 'GPU memory (proxy)'
                }
              ]}
              unit="MB"
            />
          </div>

          <div className={styles.section}>
            <div className={styles.sectionTitle}>First terminal startup history</div>
            {firstTerminal.length > 0 ? (
              <>
                <div className={styles.summary}>
                  <span>count {firstTerminal.length}</span>
                  <span>avg {avgFirst.toFixed(0)}ms</span>
                  <span>min {minFirst}ms</span>
                  <span>max {maxFirst}ms</span>
                </div>
                <div className={styles.firstTerminal}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Shell</th>
                        <th>Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {firstTerminal
                        .slice()
                        .reverse()
                        .map((entry, i) => (
                          <tr key={i}>
                            <td>{new Date(entry.iso).toLocaleString()}</td>
                            <td>{entry.shell}</td>
                            <td>{entry.durationMs}ms</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className={styles.empty}>Open a terminal to record startup time.</div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
