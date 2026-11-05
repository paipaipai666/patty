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

type ProbeMode = 'normal' | 'shell-trace'
type TraceOrder = 'record-first' | 'control-first'

async function command(pane: PaneProbe, prefix = '', mode: ProbeMode = 'normal') {
  const probeId = ++sequence
  const suffix = `${probeId}_DONE`
  const marker = { text: `PATTY_${suffix}`, tail: '', receivedAt: 0, parsedAt: 0 }
  pane.marker = marker
  const start = performance.now()
  try {
    const output = `Write-Output ('PATTY_'+'${suffix}')`
    const text = mode === 'shell-trace'
      ? `__PattyBenchmarkStamp ${probeId} 0;__PattyBenchmarkStamp ${probeId} 1;${output};__PattyBenchmarkStamp ${probeId} 2`
      : prefix + output
    pane.terminal.input(`${text}\r`, true)
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
    visibleParseCalls: sum.visibleParseCalls + pane.parsing.visible.calls,
    visibleParseMs: sum.visibleParseMs + pane.parsing.visible.elapsedMs,
    hiddenParseCalls: sum.hiddenParseCalls + pane.parsing.hidden.calls,
    hiddenParseMs: sum.hiddenParseMs + pane.parsing.hidden.elapsedMs,
  }), { receivedBytes: 0, parsedBytes: 0, chunks: 0, visibleParseCalls: 0, visibleParseMs: 0, hiddenParseCalls: 0, hiddenParseMs: 0 })
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
    visibleParseCalls: after.visibleParseCalls - before.visibleParseCalls,
    visibleParseMs: after.visibleParseMs - before.visibleParseMs,
    hiddenParseCalls: after.hiddenParseCalls - before.hiddenParseCalls,
    hiddenParseMs: after.hiddenParseMs - before.hiddenParseMs,
    peakPaneQueuedBytes: Math.max(...[...panes.values()].map((pane) => pane.peakQueuedBytes)),
    ...queueSnapshot(),
  }
}

const outputLine = "(('x'*68)+\"`r`n\")"
const paced = `for($i=0;$i -lt 25;$i++){[Console]::Write(${outputLine}*64);Start-Sleep -Milliseconds 150};`
const burst = `[Console]::Write(${outputLine}*2048);`

async function measure(count: number, traceOrder: TraceOrder) {
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

  const inputSamples = async (prefix = '', mode: ProbeMode = 'normal') => {
    const samples = []
    for (let index = 0; index < 20; index++) {
      samples.push(await command(foreground, prefix, mode))
      await delay(90)
    }
    return samples
  }

  const backgroundSamples = async (name: string, prefix = '', mode: ProbeMode = 'normal') => {
    let backgroundCommandMs: number[] = []
    const result = await phase(name, async () => {
      const [input, completed] = await Promise.all([inputSamples(prefix, mode), Promise.all(background.map((pane) => command(pane, paced)))])
      backgroundCommandMs = completed.map((sample) => sample.inputToBufferMs)
      return input
    })
    return { ...result, backgroundCommandMs }
  }

  const phases = []
  phases.push(await phase('idle', () => delay(7_000)))
  phases.push(await phase('input', inputSamples))
  if (background.length) {
    phases.push(await backgroundSamples('background-output'))
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
    phases.push(await phase('switch-under-output', async () => {
      const running = Promise.all(background.map((pane) => command(pane, paced)))
      await delay(20)
      const switches = []
      for (let index = 1; index <= 20; index++) {
        const id = ids[index % count]
        const pane = panes.get(id)
        if (!pane) throw new Error('Missing switch target')
        const start = performance.now()
        const targetBytes = pane.receivedBytes
        const queuedBytes = pane.queuedBytes
        selectSession(id)
        const caughtUpAt = await until('received output parsed after selection', () =>
          pane.parsedBytes >= targetBytes ? performance.now() : undefined)
        const renderedAt = await until('render while background output continues', () =>
          pane.renderedAt > start ? pane.renderedAt : undefined)
        switches.push({ queuedBytes, catchUpMs: caughtUpAt - start, firstRenderMs: renderedAt - start })
        await frame()
      }
      const completed = await running
      return { switches, backgroundCommandMs: completed.map((sample) => sample.inputToBufferMs) }
    }))
  }
  selectSession(foregroundId)
  await frame()
  await frame()
  await delay(200)
  const checkedControl = async (prefix: string) => {
    const before = await window.terminalAPI.commandStateSnapshot(foregroundId)
    await command(foreground, prefix)
    const deadline = performance.now() + 20_000
    while (performance.now() < deadline) {
      const state = await window.terminalAPI.commandStateSnapshot(foregroundId)
      if (state && state.revision > (before?.revision ?? 0) && state.status === 'finished') {
        if (state.exitCode !== 0) throw new Error('Shell tracing command failed')
        return
      }
      await delay(10)
    }
    throw new Error('Shell tracing command did not finish')
  }
  await checkedControl(". (Join-Path $env:PATTY_E2E_INTEGRATION_HOME 'benchmark-shell-trace.ps1'); Invoke-PattyBenchmarkShellTrace Install;")
  try {
    const groups = traceOrder === 'record-first' ? ['recorded', 'disabled'] : ['disabled', 'recorded']
    for (const group of groups) {
      for (const load of background.length ? ['input', 'background'] : ['input']) {
        const name = `shell-trace-${group}-${load}`
        await checkedControl(`Invoke-PattyBenchmarkShellTrace ${group === 'recorded' ? 'Begin' : 'Pause'};`)
        await delay(200)
        phases.push(load === 'background'
          ? await backgroundSamples(name, '', 'shell-trace')
          : await phase(name, () => inputSamples('', 'shell-trace')))
        if (group === 'recorded') {
          await checkedControl(`Invoke-PattyBenchmarkShellTrace Export -Name '${name}' -ExpectedCount 20 -Path (Join-Path $env:PATTY_E2E_INTEGRATION_HOME 'benchmark-shell-traces.json');`)
        }
      }
    }
  } finally {
    await checkedControl('Invoke-PattyBenchmarkShellTrace Restore;')
  }
  await delay(200)
  phases.push(await phase('input-restored', () => inputSamples()))
  if (background.length) phases.push(await backgroundSamples('background-output-restored'))
  phases.push(await phase('settled', () => delay(7_000)))
  return {
    status: 'ok', count, traceOrder, createStartedAt, startupMs: startup, phases,
    receiptBuckets: receiptBuckets(),
    webview: navigator.userAgent, devicePixelRatio: window.devicePixelRatio,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  }
}

export async function run(): Promise<void> {
  const { count, traceOrder } = await invoke<{ count: number; traceOrder: TraceOrder }>('benchmark_exchange', { report: null })
  const report = await measure(count, traceOrder).catch((error: unknown) => ({ status: 'error', count, error: String(error) }))
  await invoke('benchmark_exchange', { report })
}
