import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, cpus, release, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { launchApp, resolveExe } from '../e2e/harness.mjs'

const output = resolve('output/terminal-benchmark/transport')
const counts = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [1, 10, 30]
if (process.platform !== 'win32' || counts.some((count) => ![1, 10, 30].includes(count))) {
  throw new Error('Run on Windows with no arguments or a list of session counts: 1, 10, 30')
}
const executableHash = createHash('sha256').update(readFileSync(resolveExe('patty-benchmark.exe'))).digest('hex')
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))

function quantiles(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  const rank = (q) => sorted[Math.ceil(q * sorted.length) - 1] ?? null
  return { samples: sorted.length, p50: rank(0.5), p95: rank(0.95), max: rank(1) }
}

function totals(sample) {
  const processes = sample.processes.filter(({ name }) => ['patty-benchmark', 'msedgewebview2'].includes(name.toLowerCase()))
  const gpu = processes.map(({ busiestGpuEnginePercent }) => busiestGpuEnginePercent).filter(Number.isFinite)
  const memory = processes.map(({ dedicatedGpuBytes }) => dedicatedGpuBytes).filter(Number.isFinite)
  return {
    processes,
    workingSetBytes: processes.reduce((sum, process) => sum + process.workingSetBytes, 0),
    privateBytes: processes.reduce((sum, process) => sum + process.privateBytes, 0),
    gpuEnginePercent: gpu.length ? Math.max(...gpu) : null,
    dedicatedGpuBytes: memory.length ? memory.reduce((sum, bytes) => sum + bytes, 0) : null,
  }
}

function resourceSummary(samples) {
  const snapshots = samples.map(totals)
  const cpu = []
  for (let i = 1; i < snapshots.length; i++) {
    const earlier = new Map(snapshots[i - 1].processes.map((process) => [process.pid, process.cpuMs]))
    const consumed = snapshots[i].processes.reduce((sum, process) =>
      sum + Math.max(0, process.cpuMs - (earlier.get(process.pid) ?? process.cpuMs)), 0)
    cpu.push(100 * consumed / (samples[i].at - samples[i - 1].at))
  }
  return {
    samples: samples.length,
    cpuPercentOfOneCore: quantiles(cpu),
    workingSetBytes: quantiles(snapshots.map((sample) => sample.workingSetBytes)),
    privateBytes: quantiles(snapshots.map((sample) => sample.privateBytes)),
    busiestGpuEnginePercent: quantiles(snapshots.map((sample) => sample.gpuEnginePercent)),
    dedicatedGpuBytes: quantiles(snapshots.map((sample) => sample.dedicatedGpuBytes)),
  }
}

function transportTimeline({ ptyOutput, receiptBuckets }) {
  const timeline = new Map()
  const bucket = (at) => {
    if (!timeline.has(at)) timeline.set(at, {
      at, readBytes: 0, dispatchedBytes: 0, dispatchedEvents: 0, dispatchNs: 0, receivedBytes: 0, receivedEvents: 0,
    })
    return timeline.get(at)
  }
  for (const [at, readBytes, dispatchedBytes, dispatchedEvents, dispatchNs] of ptyOutput.buckets) {
    Object.assign(bucket(at), { readBytes, dispatchedBytes, dispatchedEvents, dispatchNs })
  }
  for (const [at, receivedBytes, receivedEvents] of receiptBuckets) {
    Object.assign(bucket(at), { receivedBytes, receivedEvents })
  }
  let balance = 0
  return [...timeline.values()].sort((a, b) => a.at - b.at).map((item) => {
    balance += item.dispatchedBytes - item.receivedBytes
    return { ...item, dispatchedMinusReceivedBytes: balance }
  })
}

function transportSummary(timeline, phase) {
  const buckets = timeline.filter(({ at }) => at < phase.endedAt && at + 20 > phase.startedAt)
  return {
    readBytes: buckets.reduce((sum, item) => sum + item.readBytes, 0),
    dispatchedBytes: buckets.reduce((sum, item) => sum + item.dispatchedBytes, 0),
    dispatchedEvents: buckets.reduce((sum, item) => sum + item.dispatchedEvents, 0),
    dispatchElapsedMs: buckets.reduce((sum, item) => sum + item.dispatchNs, 0) / 1_000_000,
    dispatchedMinusReceivedPeakBytes: Math.max(0, ...buckets.map((item) => item.dispatchedMinusReceivedBytes)),
  }
}

function summarize(report, samples, appStartedAt) {
  const timeline = transportTimeline(report)
  const markerAt = (probeId) => report.ptyOutput.markers[probeId]
  return {
    startupMs: quantiles(report.startupMs),
    firstPromptAfterLaunchMs: report.createStartedAt - appStartedAt + report.startupMs[0],
    outputBalance: {
      dispatchedBytes: timeline.reduce((sum, item) => sum + item.dispatchedBytes, 0),
      receivedBytes: timeline.reduce((sum, item) => sum + item.receivedBytes, 0),
      dispatchedEvents: timeline.reduce((sum, item) => sum + item.dispatchedEvents, 0),
      receivedEvents: timeline.reduce((sum, item) => sum + item.receivedEvents, 0),
    },
    phases: report.phases.map(({ data, ...phase }) => {
      const commands = Array.isArray(data) && typeof data[0] === 'object' ? data : null
      const joined = commands?.filter(({ probeId, inputToReceiptMs }) =>
        Number.isFinite(markerAt(probeId)) && Number.isFinite(inputToReceiptMs))
      return {
        ...phase,
        elapsedMs: phase.endedAt - phase.startedAt,
        bytesPerSecond: phase.parsedBytes * 1000 / (phase.endedAt - phase.startedAt),
        inputToReceiptMs: commands && quantiles(commands.map((sample) => sample.inputToReceiptMs)),
        inputToBufferMs: commands && quantiles(commands.map((sample) => sample.inputToBufferMs)),
        inputToPtyDispatchMs: joined ? quantiles(joined.map(({ sentAt, probeId }) => markerAt(probeId) - sentAt)) : null,
        ptyDispatchToReceiptMs: joined ? quantiles(joined.map(({ sentAt, probeId, inputToReceiptMs }) =>
          sentAt + inputToReceiptMs - markerAt(probeId))) : null,
        firstRenderMs: phase.name === 'switch' ? quantiles(data) : null,
        transport: transportSummary(timeline, phase),
        resources: resourceSummary(samples.filter(({ at }) => at >= phase.startedAt && at <= phase.endedAt)),
      }
    }),
  }
}

async function benchmark(count) {
  const app = await launchApp({
    connectDebugger: false,
    benchmarkSessions: count,
    settings: { notifications: { claudeCode: false, openCode: false, codex: false, ohMyPi: false, qwenCode: false, copilotCli: false } },
  })
  const samplingPath = join(app.appData, 'process-samples.jsonl')
  const reportPath = join(app.appData, 'Patty', 'benchmark-report.json')
  const sampler = spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
    resolve('scripts/benchmark-processes.ps1'), '-AppPid', String(app.pid), '-OutputPath', samplingPath,
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let samplerError = ''
  sampler.stderr.on('data', (data) => { samplerError = (samplerError + data.toString()).slice(-2000) })
  sampler.on('error', (error) => { samplerError = String(error) })
  const stopped = new Promise((resolve) => sampler.once('close', resolve))
  try {
    const deadline = Date.now() + 240_000
    while (!existsSync(reportPath) && app.appExited === null && Date.now() < deadline) await delay(200)
    if (!existsSync(reportPath)) throw new Error(`No report for ${count} sessions; Patty exit: ${app.appExited}\n${app.processOutput}`)
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    if (report.status !== 'ok' || report.count !== count) throw new Error(report.error ?? 'Unexpected benchmark report')
    sampler.kill()
    await stopped
    if (!existsSync(samplingPath) || samplerError) throw new Error(`Process sampling failed: ${samplerError}`)
    const lines = readFileSync(samplingPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    const samples = lines.slice(0, -1).map(JSON.parse)
    if (!samples.some(({ processes }) => processes.some(({ name }) => name === 'msedgewebview2'))) {
      throw new Error('WebView2 processes were not captured')
    }
    const environment = {
      at: new Date().toISOString(), osRelease: release(), arch: arch(), cpu: cpus()[0].model,
      logicalCores: cpus().length, ramBytes: totalmem(), node: process.version,
      pattyVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
      xtermVersion: lock.packages['node_modules/@xterm/xterm'].version,
      executableHash,
    }
    const summary = summarize(report, samples, app.startedAt)
    const path = join(output, `${count}-sessions.json`)
    writeFileSync(path, JSON.stringify({ environment, report, samples, summary }, null, 2) + '\n')
    console.log(`[benchmark] ${count} sessions: ${path}`)
  } finally {
    sampler.kill()
    await stopped
    await app.close()
  }
}

mkdirSync(output, { recursive: true })
for (const count of counts) await benchmark(count)
