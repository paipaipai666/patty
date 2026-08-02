import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

const { workspaceState, mockSshMetricsStart, mockSshMetricsStop, mockWrite, mockOnSshMetrics } =
  vi.hoisted(() => ({
    workspaceState: {
      workspaces: [] as unknown[],
      activeWorkspaceId: 'w1' as string | null,
      focusedSessionId: 's1' as string | null
    },
    mockSshMetricsStart: vi.fn(),
    mockSshMetricsStop: vi.fn(),
    mockWrite: vi.fn(),
    mockOnSshMetrics: vi.fn()
  }))

vi.mock('../../../store/workspaceStore', () => {
  const useWorkspaceStore = (sel: (s: typeof workspaceState) => unknown) => sel(workspaceState)
  return {
    useWorkspaceStore,
    getFocusedSessionId: () => workspaceState.focusedSessionId
  }
})

Object.assign(window, {
  terminalAPI: {
    sshMetricsStart: mockSshMetricsStart,
    sshMetricsStop: mockSshMetricsStop,
    onSshMetrics: mockOnSshMetrics,
    write: mockWrite
  }
})

import { SshMonitorPanel } from '../SshMonitorPanel'
import { useSessionStore } from '../../../store/sessionStore'
import { useRemoteMetricsStore } from '../../../store/remoteMetricsStore'
import type { RawStats } from '../../../../shared/settingsTypes'

const roots: Array<ReturnType<typeof createRoot>> = []

function raw(overrides: Partial<RawStats> = {}): RawStats {
  return {
    cpuJiffies: [100, 0, 50, 800, 10, 5, 5, 30],
    memTotalKb: 1000,
    memAvailKb: 500,
    swapTotalKb: 0,
    swapFreeKb: 0,
    rxBytes: 0,
    txBytes: 0,
    diskTotalKb: 2000,
    diskUsedKb: 1000,
    ...overrides
  }
}

function setSessions(sessions: Array<Record<string, unknown>>) {
  useSessionStore.setState({
    sessions: sessions as never,
    activeSessionId: (sessions[0]?.id as string) ?? null
  })
}

const sshSession = {
  id: 's1', title: 'prod', shell: 'ssh', cwd: '', pid: 1, color: 'blue', createdAt: 0,
  collectionId: null, aiType: null,
  ssh: { host: '10.0.0.5', user: 'deploy' }
}

const localSession = {
  id: 's1', title: 'local', shell: 'powershell', cwd: 'C:\\', pid: 1, color: 'blue',
  createdAt: 0, collectionId: null, aiType: null, ssh: null
}

function render(open = true) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => { root.render(<SshMonitorPanel open={open} onClose={() => {}} />) })
  return { container, root }
}

beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  workspaceState.focusedSessionId = 's1'
  useRemoteMetricsStore.setState({ byId: {} })
})

afterEach(() => {
  roots.forEach((r) => r.unmount())
  roots.length = 0
  setSessions([])
})

describe('SshMonitorPanel', () => {
  it('renders nothing when closed', () => {
    setSessions([sshSession])
    const { container } = render(false)
    expect(container.innerHTML).toBe('')
  })

  it('shows a hint when the focused session is not ssh', () => {
    setSessions([localSession])
    const { container } = render()
    expect(container.textContent).toContain('Focus an SSH session')
    expect(container.textContent).not.toContain('Start')
  })

  it('renders sample values in cards', () => {
    setSessions([sshSession])
    useRemoteMetricsStore.getState().ingest('s1', raw(), 10_000)
    const { container } = render()
    expect(container.textContent).toContain('SSH Monitor — deploy@10.0.0.5')
    expect(container.textContent).toContain('50.0%') // memPct
    expect(container.textContent).toContain('no swap')
    expect(container.textContent).toContain('Disk /')
  })

  it('Start invokes ssh_metrics_start and never writes to the terminal', () => {
    setSessions([sshSession])
    const { container } = render()
    const startBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Start'
    )!
    act(() => { startBtn.click() })
    expect(mockSshMetricsStart).toHaveBeenCalledWith('s1')
    expect(mockWrite).not.toHaveBeenCalled()
    expect(useRemoteMetricsStore.getState().byId.s1.running).toBe(true)
  })

  it('Stop invokes ssh_metrics_stop', () => {
    setSessions([sshSession])
    useRemoteMetricsStore.getState().setRunning('s1', true)
    const { container } = render()
    const stopBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Stop'
    )!
    act(() => { stopBtn.click() })
    expect(mockSshMetricsStop).toHaveBeenCalledWith('s1')
    expect(mockWrite).not.toHaveBeenCalled()
    expect(useRemoteMetricsStore.getState().byId.s1.running).toBe(false)
  })

  it('ingests live metrics events through onSshMetrics', () => {
    setSessions([sshSession])
    let captured: ((raw: RawStats | { stale: true }) => void) | null = null
    mockOnSshMetrics.mockImplementation((_id: string, cb: typeof captured) => {
      captured = cb
      return vi.fn()
    })
    render()
    expect(mockOnSshMetrics).toHaveBeenCalledWith('s1', expect.any(Function))
    act(() => { captured!(raw()) })
    expect(useRemoteMetricsStore.getState().byId.s1.samples).toHaveLength(1)
    act(() => { captured!({ stale: true }) })
    expect(useRemoteMetricsStore.getState().byId.s1.stale).toBe(true)
  })

  // ── BUG: closing the panel / switching focus leaves the backend metrics
  // loop running on the old session. The effect cleanup only unsubscribes the
  // event listener — it must also call ssh_metrics_stop for the session it was
  // bound to.

  it('stops remote metrics when the panel is closed while running', () => {
    setSessions([sshSession])
    useRemoteMetricsStore.getState().setRunning('s1', true)
    const { root } = render(true)
    act(() => { root.render(<SshMonitorPanel open={false} onClose={() => {}} />) })
    expect(mockSshMetricsStop).toHaveBeenCalledWith('s1')
  })

  it('stops remote metrics when focus switches to another ssh session', () => {
    const s2 = { ...sshSession, id: 's2' }
    setSessions([sshSession, s2])
    useRemoteMetricsStore.getState().setRunning('s1', true)
    workspaceState.focusedSessionId = 's1'
    const { root } = render(true)
    workspaceState.focusedSessionId = 's2'
    act(() => { root.render(<SshMonitorPanel open={true} onClose={() => {}} />) })
    expect(mockSshMetricsStop).toHaveBeenCalledWith('s1')
  })

  it('stops remote metrics when the focused session becomes non-ssh', () => {
    setSessions([sshSession])
    useRemoteMetricsStore.getState().setRunning('s1', true)
    const { root } = render(true)
    setSessions([localSession])
    act(() => { root.render(<SshMonitorPanel open={true} onClose={() => {}} />) })
    expect(mockSshMetricsStop).toHaveBeenCalledWith('s1')
  })
})
