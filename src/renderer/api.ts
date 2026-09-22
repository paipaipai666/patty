import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { AppSettings, CustomTheme, SshTarget, SshProfileDraft, RawStats, SshAuthRequest, SshHostkeyRequest } from '../shared/settingsTypes'
import type { MetricSample, FirstTerminalEntry, MetricsSnapshot } from '../shared/metricsTypes'
import type { PersistedState } from '../shared/stateTypes'

const appWindow = getCurrentWindow()

type Unsubscribe = () => void


const asyncUnsub = (registration: Promise<Unsubscribe>): Unsubscribe => {
  return () => {
    void registration.then((unlisten) => unlisten())
  }
}


                
export interface ListenerHandle {
  ready: Promise<void>
  unsubscribe: Unsubscribe
}

const listenHandle = (registration: Promise<Unsubscribe>): ListenerHandle => ({
  ready: registration.then(() => undefined),
  unsubscribe: asyncUnsub(registration)
})

export const terminalAPI = {

  createSession: (id: string, cwd?: string, shell?: string, cols?: number, rows?: number, ssh?: SshTarget | null) =>
    invoke<{ pid: number; success: boolean; replay?: string | null; error?: string }>(
      'create_pty',
      { id, cwd, shell, cols, rows, ssh }
    ),

  write: (id: string, data: string) => {
    void invoke('write_pty', { id, data })
  },

  resize: (id: string, cols: number, rows: number) => {
    void invoke('resize_pty', { id, cols, rows })
  },

  kill: (id: string) => invoke<{ success: boolean; error?: string }>('kill_pty', { id }),

  onData: (id: string, callback: (data: string) => void): ListenerHandle =>
    listenHandle(listen<string>(`pty:data:${id}`, (event) => callback(event.payload))),

  onExit: (id: string, callback: (exitCode: number) => void): ListenerHandle =>
    listenHandle(listen<number>(`pty:exit:${id}`, (event) => callback(event.payload))),


  onAttentionChange: (
    callback: (sessionId: string, eventType: string | null, aiType?: string | null) => void
  ): Unsubscribe =>
    asyncUnsub(
      listen<[string, string | null, string | null | undefined]>('pty:attn', (event) =>
        callback(event.payload[0], event.payload[1], event.payload[2])
      )
    ),


  hooksClearPane: (paneId: string) => invoke<void>('hooks_clear_pane', { paneId }),
  hookServerStatus: () => invoke<{ available: boolean }>('hook_server_status'),


  windowMinimize: () => void appWindow.minimize(),
  windowMaximize: () => void appWindow.toggleMaximize(),
  windowClose: () => void appWindow.close(),

  onMaximizeChange: (callback: (maximized: boolean) => void): Unsubscribe =>
    asyncUnsub(
      appWindow.onResized(() => {
        void appWindow.isMaximized().then(callback)
      })
    ),


  sshConfigImport: () =>
    invoke<{ success: boolean; profiles: SshProfileDraft[] }>('ssh_config_import'),


  sshAuthRespond: (id: string, secret: string | null) => {
    void invoke('ssh_auth_respond', { id, secret })
  },
  sshHostkeyRespond: (id: string, trust: boolean) => {
    void invoke('ssh_hostkey_respond', { id, trust })
  },
  onSshAuth: (callback: (id: string, info: SshAuthRequest) => void): Unsubscribe =>
    asyncUnsub(
      listen<[string, SshAuthRequest]>('ssh:auth', (event) =>
        callback(event.payload[0], event.payload[1])
      )
    ),
  onSshHostkey: (callback: (id: string, info: SshHostkeyRequest) => void): Unsubscribe =>
    asyncUnsub(
      listen<[string, SshHostkeyRequest]>('ssh:hostkey', (event) =>
        callback(event.payload[0], event.payload[1])
      )
    ),


  sshMetricsStart: (id: string) => {
    void invoke('ssh_metrics_start', { id })
  },
  sshMetricsStop: (id: string) => {
    void invoke('ssh_metrics_stop', { id })
  },
  onSshMetrics: (id: string, callback: (raw: RawStats | { stale: true }) => void): Unsubscribe =>
    asyncUnsub(
      listen<RawStats | { stale: true }>(`ssh:metrics:${id}`, (event) => callback(event.payload))
    ),


  getFonts: () => invoke<string[]>('get_fonts'),


  themeExport: (theme: CustomTheme) =>
    invoke<{ success: boolean; error?: string }>('theme_export', { theme }),
  themeImport: () =>
    invoke<{ success: boolean; theme?: CustomTheme; error?: string }>('theme_import'),


  selectDirectory: () => invoke<{ canceled: boolean; directory: string | null }>('select_directory'),


  settingsGetAll: () => invoke<AppSettings>('settings_get_all'),
  settingsSet: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    invoke<AppSettings>('settings_set', { key, value }),


  stateLoad: () => invoke<PersistedState>('state_load'),
  stateSave: (state: PersistedState) => {
    void invoke('state_save', { state }).catch((err) => {
      console.error('[state] save failed:', err)
    })
  },


  perfEnabled: import.meta.env.VITE_PATTY_PERF === '1',


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
