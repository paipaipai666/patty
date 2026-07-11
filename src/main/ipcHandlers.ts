import { ipcMain, BrowserWindow, dialog } from 'electron'
import { spawn } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { MetricsCollector } from './metricsCollector'
import type { FirstTerminalEntry } from '../shared/metricsTypes'
import {
  createPty,
  writeToPty,
  resizePty,
  killPty,
  detectAvailableShells,
  getHookPort
} from './ptyManager'
import { loadSettings, saveSettings } from './settingsHandler'
import { loadState, saveState } from './stateHandler'
import type { PersistedState } from '../shared/stateTypes'
import type { CustomTheme } from '../shared/settingsTypes'
import { perfTimerStart, perfTimerEnd, perfCounter, perfDump } from '../shared/perf'

// Map Windows code page numbers to TextDecoder encoding labels.
// NOTE: CP437/CP850 are approximated as 'latin1'. Their extended ranges
// (0x80–0xFF) differ from ISO-8859-1, so accented glyphs may be slightly off.
// This is a known approximation, not exact decoding — do not copy this mapping
// elsewhere expecting fidelity.
function codepageToEncoding(cp: number): string {
  switch (cp) {
    case 437:
    case 850:
      return 'latin1'
    case 1252:
      return 'windows-1252'
    case 936:
      return 'gbk'
    case 932:
      return 'shift_jis'
    case 949:
      return 'euc-kr'
    case 65001:
      return 'utf-8'
    default:
      return 'utf-8'
  }
}

// Decode a Buffer using the given encoding, falling back to utf-8 if the
// runtime lacks ICU data for that encoding (rare) — a scan must never reject
// solely over a decoding detail.
function decodeBuffer(buf: Buffer, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

let codepageCache: string | null = null
let fontsCache: string[] | null = null
let fontsPromise: Promise<string[]> | null = null

// Detect the active OEM code page once. `chcp` output carries the digits in
// ASCII (codepage-invariant), so a loose numeric match is language-safe.
function detectCodepage(): Promise<string> {
  if (codepageCache) return Promise.resolve(codepageCache)
  return new Promise<string>((resolve) => {
    try {
      const child = spawn('chcp', [], { windowsHide: true })
      let out = ''
      child.stdout?.on('data', (d: Buffer) => {
        out += d.toString('utf-8')
      })
      child.on('error', () => resolve('utf-8'))
      child.on('close', () => {
        const m = out.match(/(\d{3,5})/)
        const cp = m ? parseInt(m[1], 10) : 65001
        codepageCache = codepageToEncoding(cp)
        resolve(codepageCache)
      })
    } catch {
      resolve('utf-8')
    }
  })
}

// Scan one registry font key, resolving with the raw stdout Buffer. A missing
// key or non-zero reg exit yields an (empty) buffer — a "normal empty result",
// not an error. Only a spawn failure (e.g. reg.exe missing) rejects.
function scanFontKey(key: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn('reg', ['query', key, '/s'], { windowsHide: true })
    const chunks: Buffer[] = []
    child.stdout?.on('data', (d: Buffer) => chunks.push(d))
    child.on('error', (err) => reject(err))
    child.on('close', () => resolve(Buffer.concat(chunks)))
  })
}

function parseFonts(text: string): string[] {
  const fonts = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s+(.+?)\s+REG_(SZ|EXPAND_SZ)\s+(.+)$/)
    if (match) {
      const name = match[1].trim()
      const clean = name.replace(/\s*\((?:TrueType|OpenType|All res)\)\s*$/i, '').trim()
      if (clean) fonts.add(clean)
    }
  }
  return [...fonts]
}

async function getInstalledFonts(): Promise<string[]> {
  if (fontsCache) return fontsCache
  if (fontsPromise) return fontsPromise

  perfTimerStart('fonts:enumerate')
  // Launch codepage detection concurrently with both registry scans so the
  // first call isn't serialized behind the probe.
  fontsPromise = (async () => {
    const [codepageRes, hklmRes, hkcuRes] = await Promise.allSettled([
      detectCodepage(),
      scanFontKey('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts'),
      scanFontKey('HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts')
    ])
    const encoding = codepageRes.status === 'fulfilled' ? codepageRes.value : 'utf-8'

    const scans: PromiseSettledResult<Buffer>[] = [hklmRes, hkcuRes]
    // Partial success: any fulfilled scan contributes. Only if BOTH reject
    // (reg.exe can't run) do we fail — keeping the cache empty so it's retryable.
    if (!scans.some((r) => r.status === 'fulfilled')) {
      throw new Error('Font registry scan failed')
    }

    const fonts = new Set<string>()
    for (const r of scans) {
      if (r.status === 'fulfilled') {
        for (const f of parseFonts(decodeBuffer(r.value, encoding))) fonts.add(f)
      }
    }
    const result = [...fonts].sort()
    fontsCache = result
    return result
  })().finally(() => {
    fontsPromise = null
    perfTimerEnd('fonts:enumerate')
  })

  return fontsPromise
}

export function registerIpcHandlers(getWindow: () => BrowserWindow | null, metricsCollector: MetricsCollector): void {
  // Settings handlers
  ipcMain.handle('settings:getAll', () => {
    return loadSettings()
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    const settings = loadSettings()
    ;(settings as unknown as Record<string, unknown>)[key] = value
    saveSettings(settings)
    return settings
  })

  // State handlers
  ipcMain.handle('state:load', () => {
    return loadState()
  })

  ipcMain.on('state:save', (_event, state: PersistedState) => {
    saveState(state)
  })

  // Directory picker
  ipcMain.handle('dialog:selectDirectory', async () => {
    try {
      const win = getWindow()
      if (!win) return { canceled: true, directory: null }
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory'],
        title: 'Select project directory'
      })
      return { canceled: result.canceled, directory: result.filePaths[0] || null }
    } catch (err) {
      console.error('Directory selection failed:', err)
      return { canceled: true, directory: null }
    }
  })

  // PTY handlers
  ipcMain.handle('pty:create', (event, id: string, cwd?: string, shell?: string, cols?: number, rows?: number) => {
    try {
      const term = createPty(id, cwd, shell, cols, rows)

      // Forward PTY data to renderer
      term.onData((data) => {
        perfCounter('pty:data:ipc')
        const win = getWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send(`pty:data:${id}`, data)
        }
      })

      // Forward PTY exit to renderer
      term.onExit(({ exitCode }) => {
        const win = getWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send(`pty:exit:${id}`, exitCode)
        }
      })

      return { pid: term.pid, success: true }
    } catch (error) {
      console.error('Failed to create PTY:', error)
      return { pid: 0, success: false, error: String(error) }
    }
  })

  ipcMain.on('pty:write', (_event, id: string, data: string) => {
    writeToPty(id, data)
  })

  ipcMain.on('pty:resize', (_event, id: string, cols: number, rows: number) => {
    resizePty(id, cols, rows)
  })

  ipcMain.handle('pty:kill', (_event, id: string) => {
    try {
      killPty(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // Shell detection
  ipcMain.handle('shell:detect', () => {
    return detectAvailableShells()
  })

  // System fonts
  ipcMain.handle('system:getFonts', () => {
    return getInstalledFonts()
  })

  // Hook port
  ipcMain.handle('system:getHookPort', () => {
    return getHookPort()
  })

  // Reset attention for a pane
  ipcMain.on('pty:resetAttention', (_event, id: string) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('pty:attn', id, null)
    }
  })

  // Theme export
  ipcMain.handle('theme:export', async (_event, theme: CustomTheme) => {
    try {
      const win = getWindow()
      if (!win) return { success: false }
      const result = await dialog.showSaveDialog(win, {
        title: 'Export Theme',
        defaultPath: `${theme.name}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (result.canceled || !result.filePath) return { success: false }
      writeFileSync(result.filePath, JSON.stringify(theme, null, 2), 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Theme import
  ipcMain.handle('theme:import', async () => {
    try {
      const win = getWindow()
      if (!win) return { success: false }
      const result = await dialog.showOpenDialog(win, {
        title: 'Import Theme',
        filters: [{ name: 'JSON', extensions: ['json'] }],
        properties: ['openFile']
      })
      if (result.canceled || result.filePaths.length === 0) return { success: false }
      const raw = readFileSync(result.filePaths[0], 'utf-8')
      const theme = JSON.parse(raw) as CustomTheme
      if (!theme.name || !theme.ui || !theme.terminal) {
        return { success: false, error: 'Invalid theme file' }
      }
      theme.id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      return { success: true, theme }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Window controls
  ipcMain.on('window:minimize', () => {
    getWindow()?.minimize()
  })

  ipcMain.on('window:maximize', () => {
    const win = getWindow()
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.on('window:close', () => {
    getWindow()?.close()
  })

  // Perf dump (for benchmark script)
  ipcMain.handle('perf:dump', () => {
    perfDump()
    return { success: true }
  })

  // Metrics dashboard
  ipcMain.handle('metrics:history', () => {
    return metricsCollector.getSnapshot()
  })

  ipcMain.handle('metrics:recordFirstTerminal', (_event, entry: FirstTerminalEntry) => {
    metricsCollector.recordFirstTerminal(entry)
    return { success: true }
  })
}
