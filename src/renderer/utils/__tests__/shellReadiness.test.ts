import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let markTerminalOpen: (id: string, shell: string) => void
let markShellReady: (id: string) => void

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', {
    terminalAPI: {
      metricsRecordFirstTerminal: vi.fn()
    }
  })
  vi.resetModules()
  const mod = await import('../shellReadiness')
  markTerminalOpen = mod.markTerminalOpen
  markShellReady = mod.markShellReady
})

afterEach(() => {
  vi.useRealTimers()
})

describe('shellReadiness', () => {
  it('markTerminalOpen sets pending state, markShellReady records metric', () => {
    vi.setSystemTime(1000)
    markTerminalOpen('s1', 'powershell')

    vi.setSystemTime(2500)
    markShellReady('s1')

    expect(window.terminalAPI.metricsRecordFirstTerminal).toHaveBeenCalledWith({
      iso: new Date(2500).toISOString(),
      shell: 'powershell',
      durationMs: 1500
    })
  })

  it('markShellReady with non-matching id does nothing', async () => {
    vi.setSystemTime(1000)
    markTerminalOpen('s1', 'powershell')

    markShellReady('other')

    expect(window.terminalAPI.metricsRecordFirstTerminal).not.toHaveBeenCalled()
  })

  it('second call to markTerminalOpen after measurement is ignored', () => {
    vi.setSystemTime(1000)
    markTerminalOpen('s1', 'powershell')
    vi.setSystemTime(1500)
    markShellReady('s1')

    vi.setSystemTime(2000)
    markTerminalOpen('s2', 'bash')

    expect(window.terminalAPI.metricsRecordFirstTerminal).toHaveBeenCalledTimes(1)
  })
})
