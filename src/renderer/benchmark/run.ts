import { invoke } from '@tauri-apps/api/core'
import { createTerminal, selectSession } from '../store/sessionLifecycle'
import { useSessionStore } from '../store/sessionStore'
import { useSettingsStore } from '../store/settingsStore'
import { panes, queueSnapshot, receiptBuckets, resetPeak, type PaneProbe } from './probe'

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const clock = () => performance.timeOrigin + performance.now()
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))

async function until<T>(label: string, sample: () => T | undefined, timeout = 20_000): Promise<T> {
  const end = performance.now() + timeout
  while (performance.now() < end) {
    const value = sample()
    if (value !== undefined) return value
    await delay(4)
  }
  throw new Error(`Timed out: ${label}`)
}

let sequence = 0

async function command(pane: PaneProbe, prefix = '') {
  const probeId = ++sequence
  const suffix = `${probeId}_DONE`
  const marker = { text: `PATTY_${suffix}`, tail: '', receivedAt: 0, parsedAt: 0 }
  pane.marker = marker
  const start = performance.now()
  try {
    pane.terminal.input(`${prefix}Write-Output ('PATTY_'+'${suffix}')\r`, true)
    await until(marker.text, () => marker.parsedAt || undefined, 45_000)
    return {
      probeId,
      sentAt: performance.timeOrigin + start,
      inputToReceiptMs: marker.receivedAt ? marker.receivedAt - start : null,
      inputToBufferMs: marker.parsedAt - start,
    }
  } finally {
    pane.marker = null
  }
}

function counters() {
  return [...panes.values()].reduce((sum, pane) => ({
    receivedBytes: sum.receivedBytes + pane.receivedBytes,
    parsedBytes: sum.parsedBytes + pane.parsedBytes,
    chunks: sum.chunks + pane.chunks,
  }), { receivedBytes: 0, parsedBytes: 0, chunks: 0 })
}

async function phase<T>(name: string, action: () => Promise<T>) {
  const before = counters()
  resetPeak()
  for (const pane of panes.values()) pane.peakQueuedBytes = pane.queuedBytes
  const startedAt = clock()
  const data = await action()
  const endedAt = clock()
  const after = counters()
  return {
    name, startedAt, endedAt, data,
    receivedBytes: after.receivedBytes - before.receivedBytes,
    parsedBytes: after.parsedBytes - before.parsedBytes,
    chunks: after.chunks - before.chunks,
    peakPaneQueuedBytes: Math.max(...[...panes.values()].map((pane) => pane.peakQueuedBytes)),
    ...queueSnapshot(),
  }
}

const outputLine = "(('x'*68)+\"`r`n\")"
const paced = `for($i=0;$i -lt 25;$i++){[Console]::Write(${outputLine}*64);Start-Sleep -Milliseconds 150};`
const burst = `[Console]::Write(${outputLine}*2048);`

async function measure(count: number) {
  await until('session and settings restored', () =>
    useSessionStore.getState().loaded && useSettingsStore.getState().loaded ? true : undefined)
  if (useSessionStore.getState().sessions.length !== 0) throw new Error('Expected empty benchmark workbench')
  const startup = []
  const ids: string[] = []
  const createStartedAt = clock()
  for (let index = 0; index < count; index++) {
    const start = performance.now()
    const id = createTerminal({ shell: 'powershell', title: `Benchmark ${index + 1}` })
    ids.push(id)
    const pane = await until(`PowerShell prompt ${index + 1}`, () => {
      const pane = panes.get(id)
      return pane?.readyAt ? pane : undefined
    })
    await frame()
    await command(pane)
    startup.push(pane.readyAt - start)
  }

  const foregroundId = ids[0]
  selectSession(foregroundId)
  await frame()
  await frame()
  const foreground = panes.get(foregroundId)
  if (!foreground || panes.size !== count) throw new Error(`Expected ${count} mounted terminals`)
  const background = [...panes.entries()].filter(([id]) => id !== foregroundId).map(([, pane]) => pane)

  const inputSamples = async () => {
    const samples = []
    for (let index = 0; index < 20; index++) {
      samples.push(await command(foreground))
      await delay(90)
    }
    return samples
  }

  const phases = []
  phases.push(await phase('idle', () => delay(7_000)))
  phases.push(await phase('input', inputSamples))
  if (background.length) {
    phases.push(await phase('background-output', async () => {
      const [input] = await Promise.all([inputSamples(), Promise.all(background.map((pane) => command(pane, paced)))])
      return input
    }))
  }
  phases.push(await phase('burst', () => Promise.all([...panes.values()].map((pane) => command(pane, burst)))))
  if (background.length) {
    phases.push(await phase('switch', async () => {
      const samples = []
      for (let index = 1; index <= 20; index++) {
        const id = ids[index % count]
        const pane = panes.get(id)
        if (!pane) throw new Error(`Missing terminal ${index % count}`)
        const start = performance.now()
        selectSession(id)
        const renderedAt = await until('first terminal render after selection', () =>
          pane.renderedAt > start ? pane.renderedAt : undefined)
        samples.push(renderedAt - start)
        await frame()
      }
      return samples
    }))
  }
  phases.push(await phase('settled', () => delay(7_000)))
  return {
    status: 'ok', count, createStartedAt, startupMs: startup, phases,
    receiptBuckets: receiptBuckets(),
    webview: navigator.userAgent, devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }
}

export async function run(): Promise<void> {
  const count = await invoke<number>('benchmark_exchange', { report: null })
  const report = await measure(count).catch((error: unknown) => ({ status: 'error', count, error: String(error) }))
  await invoke('benchmark_exchange', { report })
}
