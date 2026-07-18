import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { AppSettings, CustomTheme } from '../shared/settingsTypes'
import type { MetricSample, FirstTerminalEntry, MetricsSnapshot } from '../shared/metricsTypes'
import type { PersistedState } from '../shared/stateTypes'

const appWindow = getCurrentWindow()

type Unsubscribe = () => void

// Tauri's listen() is async; adapt to the sync unsubscribe shape the renderer
// expects from the old preload bridge. Unsubscribing before the listener is
// registered still tears it down once registration resolves.
const asyncUnsub = (registration: Promise<Unsubscribe>): Unsubscribe => {
  return () => {
    void registration.then((unlisten) => unlisten())
  }
}

export const terminalAPI = {
  // Session management
  createSession: (id: string, cwd?: string, shell?: string, cols?: number, rows?: number) =>
    invoke<{ pid: number; success: boolean; replay?: string | null; error?: string }>(
      'create_pty',
      { id, cwd, shell, cols, rows }
    ),

  write: (id: string, data: string) => {
    void invoke('write_pty', { id, data })
  },

  resize: (id: string, cols: number, rows: number) => {
    void invoke('resize_pty', { id, cols, rows })
  },

  kill: (id: string) => invoke<{ success: boolean; error?: string }>('kill_pty', { id }),

  onData: (id: string, callback: (data: string) => void): Unsubscribe =>
    asyncUnsub(listen<string>(`pty:data:${id}`, (event) => callback(event.payload))),

  onExit: (id: string, callback: (exitCode: number) => void): Unsubscribe =>
    asyncUnsub(listen<number>(`pty:exit:${id}`, (event) => callback(event.payload))),

  // Attention management
  resetAttention: (id: string) => {
    void invoke('reset_attention', { id })
  },

  onAttentionChange: (
    callback: (sessionId: string, eventType: string | null, aiType?: string | null) => void
  ): Unsubscribe =>
    asyncUnsub(
      listen<[string, string | null, string | null | undefined]>('pty:attn', (event) =>
        callback(event.payload[0], event.payload[1], event.payload[2])
      )
    ),

  onPtyExit: (callback: (sessionId: string, exitCode: number) => void): Unsubscribe =>
    asyncUnsub(
      listen<[string, number]>('pty:exit', (event) => callback(event.payload[0], event.payload[1]))
    ),

  // Hook port
  getHookPort: () => invoke<number>('get_hook_port'),

  // Window controls
  windowMinimize: () => void appWindow.minimize(),
  windowMaximize: () => void appWindow.toggleMaximize(),
  windowClose: () => void appWindow.close(),

  onMaximizeChange: (callback: (maximized: boolean) => void): Unsubscribe =>
    asyncUnsub(
      appWindow.onResized(() => {
        void appWindow.isMaximized().then(callback)
      })
    ),

  // Shell detection
  detectShells: () =>
    invoke<Array<{ name: string; path: string; available: boolean }>>('detect_shells'),

  // System fonts
  getFonts: () => invoke<string[]>('get_fonts'),

  // Theme import/export
  themeExport: (theme: CustomTheme) =>
    invoke<{ success: boolean; error?: string }>('theme_export', { theme }),
  themeImport: () =>
    invoke<{ success: boolean; theme?: CustomTheme; error?: string }>('theme_import'),

  // Directory selection
  selectDirectory: () => invoke<{ canceled: boolean; directory: string | null }>('select_directory'),

  // Settings
  settingsGetAll: () => invoke<AppSettings>('settings_get_all'),
  settingsSet: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    invoke<AppSettings>('settings_set', { key, value }),

  // State persistence
  stateLoad: () => invoke<PersistedState>('state_load'),
  stateSave: (state: PersistedState) => {
    void invoke('state_save', { state })
  },

  // Perf
  perfEnabled: import.meta.env.VITE_PATTY_PERF === '1',
  perfDump: () => invoke<{ success: boolean }>('perf_dump'),

  // Metrics dashboard
  metricsHistory: () => invoke<MetricsSnapshot>('metrics_history'),
  onMetricsTick: (callback: (sample: MetricSample) => void): Unsubscribe =>
    asyncUnsub(listen<MetricSample>('metrics:tick', (event) => callback(event.payload))),
  metricsRecordFirstTerminal: (entry: FirstTerminalEntry) =>
    invoke<{ success: boolean }>('metrics_record_first_terminal', { entry }),
  metricsSetSampling: (enabled: boolean) => {
    void invoke('metrics_set_sampling', { enabled })
  }
}

window.terminalAPI = terminalAPI

export type TerminalAPI = typeof terminalAPI
