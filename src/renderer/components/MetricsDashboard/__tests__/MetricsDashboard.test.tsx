import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'

import { MetricsDashboard } from '../MetricsDashboard'
import type { MetricsSnapshot } from '../../../../shared/metricsTypes'

const mockSnapshot: MetricsSnapshot = {
  samples: [
    { timestamp: 1, appCpu: 12.3, systemCpu: 45.6, appMemMB: 256, systemMemUsedMB: 8000, systemMemTotalMB: 16384, gpuUtil: 30, gpuMemMB: 512, gpuProxy: false },
    { timestamp: 2, appCpu: 15.1, systemCpu: 48.2, appMemMB: 260, systemMemUsedMB: 8100, systemMemTotalMB: 16384, gpuUtil: 28, gpuMemMB: 520, gpuProxy: false }
  ],
  firstTerminal: [
    { iso: '2026-07-20T12:00:00Z', shell: 'powershell', durationMs: 1200 }
  ]
}

let terminalAPI: Record<string, any>

beforeEach(() => {
  terminalAPI = {
    metricsHistory: vi.fn().mockResolvedValue(mockSnapshot),
    onMetricsTick: vi.fn(() => vi.fn())
  }
  ;(window as any).terminalAPI = terminalAPI
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  document.body.innerHTML = ''
})

afterEach(() => {
  delete (window as any).terminalAPI
})

function render(props: { open: boolean; onClose?: () => void }) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => { root.render(<MetricsDashboard open={props.open} onClose={props.onClose ?? vi.fn()} />) })
  return { container, root }
}

describe('MetricsDashboard', () => {
  it('returns null when open=false', () => {
    const { container } = render({ open: false })
    expect(container.innerHTML).toBe('')
  })

  it('renders dashboard layout when open=true', async () => {
    const { container } = render({ open: true })
    await act(async () => {})
    expect(container.textContent).toContain('Performance')
    expect(container.textContent).toContain('CPU')
    expect(container.textContent).toContain('Memory')
    expect(container.textContent).toContain('GPU')
  })

  it('shows CPU, Memory, GPU cards with values', async () => {
    const { container } = render({ open: true })
    await act(async () => {})
    expect(container.textContent).toContain('15.1%')
    expect(container.textContent).toContain('48.2%')
    expect(container.textContent).toContain('260 MB')
    expect(container.textContent).toContain('520 MB')
  })

  it('shows first terminal startup data', async () => {
    const { container } = render({ open: true })
    await act(async () => {})
    expect(container.textContent).toContain('1200')
    expect(container.textContent).toContain('powershell')
  })

  it('shows placeholder when no firstTerminal data', async () => {
    terminalAPI.metricsHistory = vi.fn().mockResolvedValue({
      samples: [],
      firstTerminal: []
    })
    const { container } = render({ open: true })
    await act(async () => {})
    expect(container.textContent).toContain('Open a terminal to record')
  })

  it('calls metricsHistory on open', async () => {
    render({ open: true })
    await act(async () => {})
    expect(terminalAPI.metricsHistory).toHaveBeenCalledTimes(1)
  })

  it('does not call metricsHistory when closed', () => {
    render({ open: false })
    expect(terminalAPI.metricsHistory).not.toHaveBeenCalled()
  })

  it('calls onClose when overlay is clicked', async () => {
    const onClose = vi.fn()
    const { container } = render({ open: true, onClose })
    await act(async () => {})
    const overlay = container.firstElementChild as HTMLElement
    act(() => { overlay.click() })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
