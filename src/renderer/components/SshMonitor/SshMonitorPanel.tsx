import { useEffect, useMemo } from 'react'
import { useSessionStore } from '../../store/sessionStore'
import { useWorkspaceStore, getFocusedSessionId } from '../../store/workspaceStore'
import { useRemoteMetricsStore } from '../../store/remoteMetricsStore'
import { HistoryChart } from '../MetricsDashboard/MetricsDashboard'
import styles from './SshMonitorPanel.module.css'

// SSH monitor: CPU/mem/swap/net/disk sampled over exec channels multiplexed
// on the session's own SSH connection (sshconn.rs). No terminal injection —
// starting/stopping collection never echoes into the shell.

interface SshMonitorPanelProps {
  open: boolean
  onClose: () => void
}

function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`
}

function formatKB(kb: number): string {
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`
}

function formatRate(kbps: number): string {
  return kbps >= 1024 ? `${(kbps / 1024).toFixed(1)} MB/s` : `${kbps.toFixed(1)} KB/s`
}

export function SshMonitorPanel({ open, onClose }: SshMonitorPanelProps) {
  // Follow the focused pane (same dual-store pattern as CommandBar).
  useWorkspaceStore((s) => s.workspaces)
  useWorkspaceStore((s) => s.activeWorkspaceId)
  const sessionId = getFocusedSessionId()
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId))
  const entry = useRemoteMetricsStore((s) => (sessionId ? s.byId[sessionId] : undefined))
  const { ingest, setRunning, setStale } = useRemoteMetricsStore.getState()

  const isSsh = !!session && session.shell === 'ssh'
  const running = entry?.running ?? false

  // Live metrics subscription, bound to the focused ssh session.
  useEffect(() => {
    if (!open || !isSsh || !sessionId) return
    const un = window.terminalAPI.onSshMetrics(sessionId, (raw) => {
      if ('stale' in raw) {
        setStale(sessionId)
      } else {
        ingest(sessionId, raw)
      }
    })
    return un
  }, [open, isSsh, sessionId, ingest, setStale])

  const samples = entry?.samples ?? []

  const cpuSeries = useMemo(
    () => [{ data: samples.map((s) => s.cpuPct), color: 'var(--cyan)', label: 'CPU %' }],
    [samples]
  )
  const memSeries = useMemo(
    () => [{ data: samples.map((s) => s.memPct), color: 'var(--green)', label: 'Memory %' }],
    [samples]
  )
  const netSeries = useMemo(
    () => [
      { data: samples.map((s) => s.rxKBps), color: 'var(--cyan)', label: '↓ RX' },
      { data: samples.map((s) => s.txKBps), color: 'var(--amber)', label: '↑ TX' }
    ],
    [samples]
  )

  if (!open) return null

  const target = session?.ssh?.user
    ? `${session.ssh.user}@${session.ssh.host}`
    : session?.ssh?.host ?? 'SSH'

  const start = () => {
    if (!sessionId) return
    window.terminalAPI.sshMetricsStart(sessionId)
    setRunning(sessionId, true)
  }
  const stop = () => {
    if (!sessionId) return
    window.terminalAPI.sshMetricsStop(sessionId)
    setRunning(sessionId, false)
  }

  const latest = samples[samples.length - 1]

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.dashboard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span>SSH Monitor — {target}</span>
          <button className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {!isSsh ? (
          <div className={styles.content}>
            <div className={styles.empty}>Focus an SSH session to monitor it.</div>
          </div>
        ) : (
          <div className={styles.content}>
            <div className={styles.controls}>
              {running ? (
                <button className={styles.controlBtn} onClick={stop}>
                  Stop
                </button>
              ) : (
                <button className={styles.controlBtn} onClick={start}>
                  Start
                </button>
              )}
              {entry?.stale && <span className={styles.stale}>connection lost — collection stopped</span>}
            </div>

            <div className={styles.liveGrid}>
              <div className={styles.card}>
                <div className={styles.cardTitle}>CPU</div>
                <div className={styles.cardValue}>{latest ? formatPercent(latest.cpuPct) : '--'}</div>
                <div className={styles.cardSub}>all cores, /proc/stat</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardTitle}>Memory</div>
                <div className={styles.cardValue}>{latest ? formatPercent(latest.memPct) : '--'}</div>
                <div className={styles.cardSub}>
                  {entry?.lastRaw
                    ? `used ${formatKB(entry.lastRaw.memTotalKb - entry.lastRaw.memAvailKb)} / ${formatKB(entry.lastRaw.memTotalKb)}`
                    : '--'}
                </div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardTitle}>Swap</div>
                <div className={styles.cardValue}>
                  {latest && (entry?.lastRaw?.swapTotalKb ?? 0) > 0 ? formatPercent(latest.swapPct) : '--'}
                </div>
                <div className={styles.cardSub}>
                  {(entry?.lastRaw?.swapTotalKb ?? 0) > 0 ? `total ${formatKB(entry?.lastRaw?.swapTotalKb ?? 0)}` : 'no swap'}
                </div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardTitle}>Network</div>
                <div className={styles.cardValue}>{latest ? `↓ ${formatRate(latest.rxKBps)}` : '--'}</div>
                <div className={styles.cardSub}>{latest ? `↑ ${formatRate(latest.txKBps)}` : '--'}</div>
              </div>
              <div className={styles.card}>
                <div className={styles.cardTitle}>Disk /</div>
                <div className={styles.cardValue}>{latest ? formatPercent(latest.diskUsedPct) : '--'}</div>
                <div className={styles.cardSub}>
                  {latest ? `${formatKB(latest.diskUsedKB)} / ${formatKB(latest.diskTotalKB)}` : '--'}
                </div>
              </div>
            </div>

            <div className={styles.section}>
              <div className={styles.sectionTitle}>History</div>
              <HistoryChart series={cpuSeries} maxY={100} unit="%" />
              <HistoryChart series={memSeries} maxY={100} unit="%" />
              <HistoryChart series={netSeries} unit=" KB/s" />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
