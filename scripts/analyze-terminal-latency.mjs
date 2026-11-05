import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const rank = fraction => sorted[Math.ceil(sorted.length * fraction) - 1] ?? null
  return { samples: sorted.length, p50: rank(0.5), p95: rank(0.95), max: rank(1) }
}

function stages(sample, trace) {
  const id = sample.probeId
  assert.ok([id, sample.sentAt, sample.inputToReceiptMs, sample.inputToBufferMs].every(Number.isFinite), `Missing paired timestamps for probe ${id}`)
  const times = [sample.sentAt, trace.inputReceivedMarkers[id], trace.inputQueuedMarkers[id], trace.inputWriteMarkers[id],
    trace.inputWrittenMarkers[id], trace.readMarkers[id], trace.markers[id], sample.sentAt + sample.inputToReceiptMs, sample.sentAt + sample.inputToBufferMs]
  assert.ok(times.every(Number.isFinite), `Missing paired timestamps for probe ${id}`)
  const names = ['inputToRust', 'rustToQueue', 'queueToWrite', 'write', 'childAndConpty', 'outputBatch', 'outputIPC', 'parse']
  return Object.fromEntries(names.map((name, index) => {
    const duration = times[index + 1] - times[index]
    assert.ok(duration >= -1, `Out-of-order ${name} timestamps for probe ${id}`)
    return [name, duration]
  }))
}

export function analyzeReport(raw) {
  assert.equal(raw.report.status, 'ok', 'A failed benchmark cannot supply latency evidence')
  const samples = raw.samples.map(sample => sample.at)
  const intervals = samples.slice(1).map((at, index) => at - samples[index])
  const phases = raw.report.phases.filter(phase => Array.isArray(phase.data) && phase.data.length && typeof phase.data[0]?.probeId === 'number').map(phase => {
    const commands = phase.data.map((sample, index) => {
      const spans = stages(sample, raw.report.ptyOutput)
      const largestStage = Object.entries(spans).sort((a, b) => b[1] - a[1])[0][0]
      return { index, probeId: sample.probeId, totalMs: sample.inputToBufferMs, largestStage, stagesMs: spans }
    })
    const dominant = {}
    for (const command of commands) dominant[command.largestStage] = (dominant[command.largestStage] ?? 0) + 1
    return { name: phase.name, inputMs: quantiles(commands.map(command => command.totalMs)), largestStageCounts: dominant,
      resourceSamples: samples.filter(at => at >= phase.startedAt && at <= phase.endedAt).length,
      stagesMs: Object.fromEntries(Object.keys(commands[0].stagesMs).map(stage => [stage, quantiles(commands.map(command => command.stagesMs[stage]))])),
      slowest: [...commands].sort((a, b) => b.totalMs - a.totalMs).slice(0, 2) }
  })
  return { executableHash: raw.environment.executableHash, samplerMode: raw.environment.resourceMode ?? 'full',
    samplerIntervalMs: quantiles(intervals), resourceSamples: samples.length, phases }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const output = args[0] === '--out' ? args[1] : null
  const inputs = output ? args.slice(2) : args
  assert.ok(inputs.length > 0, 'Usage: node scripts/analyze-terminal-latency.mjs [--out report.json] benchmark.json ...')
  const result = inputs.map(path => ({ path: resolve(path), ...analyzeReport(JSON.parse(readFileSync(path, 'utf8'))) }))
  const payload = JSON.stringify(result, null, 2) + '\n'
  if (output) { mkdirSync(dirname(resolve(output)), { recursive: true }); writeFileSync(output, payload) }
  else process.stdout.write(payload)
  if (output) console.log(`Analyzed ${inputs.length} reports: ${resolve(output)}`)
}
