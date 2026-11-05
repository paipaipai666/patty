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

function shellTraces(raw) {
  const phases = raw.report.phases.filter(phase => phase.name.startsWith('shell-trace-recorded-'))
  if (!phases.length && raw.report.shellTraces === undefined) return new Map()
  const batches = raw.report.shellTraces
  assert.ok(Array.isArray(batches) && batches.length > 0 && batches.length <= 4 && batches.length === phases.length, 'Shell trace batches are missing or duplicated')
  assert.ok(Buffer.byteLength(JSON.stringify(batches)) <= 65536, 'Shell trace exceeds 64 KiB')
  const result = new Map()
  const usedIds = new Set()
  for (const batch of batches) {
    assert.ok(batch && typeof batch === 'object' && !Array.isArray(batch), 'Shell trace batch must be an object')
    const phase = phases.find(phase => phase.name === batch.name)
    assert.ok(phase && !result.has(batch.name), 'Shell trace batch does not match one phase')
    const frequency = batch.frequency
    assert.ok(Number.isFinite(frequency) && frequency > 0, 'Shell trace clock frequency is invalid')
    const clocks = [batch.clockBefore, batch.clockAfter]
    for (const clock of clocks) {
      assert.ok(Array.isArray(clock) && clock.length === 3 && clock.every(value => Number.isFinite(value) && value > 0) && clock[2] >= clock[0], 'Shell trace clock calibration is invalid')
    }
    assert.ok(batch.clockAfter[0] >= batch.clockBefore[2] && batch.clockAfter[1] >= batch.clockBefore[1], 'Shell trace clock calibrations are reversed')
    const offsets = clocks.map(([before, epoch, after]) => ({ low: epoch - after * 1000 / frequency, high: epoch - before * 1000 / frequency }))
    const low = Math.min(...offsets.map(offset => offset.low))
    const high = Math.max(...offsets.map(offset => offset.high))
    const offset = (low + high) / 2
    const uncertaintyMs = (high - low) / 2
    const offsetDriftMs = (offsets[1].low + offsets[1].high - offsets[0].low - offsets[0].high) / 2
    assert.ok(Array.isArray(phase.data) && Array.isArray(batch.rows) && batch.rows.length > 0 && batch.rows.length <= 256 && batch.rows.length === phase.data.length, 'Shell trace probe count mismatch')
    const samples = new Map(phase.data.map(sample => [sample.probeId, sample]))
    assert.equal(samples.size, phase.data.length, 'Shell trace phase has duplicate probes')
    const commands = batch.rows.map(row => {
      assert.ok(Array.isArray(row) && row.length === 7 && row.every(value => Number.isFinite(value) && value > 0), 'Shell trace has an incomplete probe')
      const [id, editor, classifyStart, classifyEnd, execute, outputStart, outputEnd] = row
      assert.ok(Number.isInteger(id) && samples.has(id) && !usedIds.has(id), 'Shell trace probe is unexpected or duplicated')
      usedIds.add(id)
      assert.ok(row.slice(2).every((time, index) => time >= row[index + 1]) && editor >= batch.clockBefore[2] && outputEnd <= batch.clockAfter[0], 'Shell trace timestamps are reversed or outside calibration')
      const write = raw.report.ptyOutput.inputWrittenMarkers[id]
      const read = raw.report.ptyOutput.readMarkers[id]
      assert.ok(Number.isFinite(write) && Number.isFinite(read), 'Shell trace native timestamp is missing')
      const inputDeliveryAndEditing = editor * 1000 / frequency + offset - write
      const outputFormattingAndConptyRead = read - (outputStart * 1000 / frequency + offset)
      assert.ok(inputDeliveryAndEditing + uncertaintyMs >= 0 && outputFormattingAndConptyRead + uncertaintyMs >= 0, 'Shell trace native timestamps are reversed beyond calibration uncertainty')
      const spans = {
        inputDeliveryAndEditing,
        editorToClassification: (classifyStart - editor) * 1000 / frequency,
        classification: (classifyEnd - classifyStart) * 1000 / frequency,
        classificationToExecution: (execute - classifyEnd) * 1000 / frequency,
        executionToOutputCall: (outputStart - execute) * 1000 / frequency,
        outputFormattingAndConptyRead,
      }
      const bounds = duration => ({ low: duration - uncertaintyMs, high: duration + uncertaintyMs })
      const crossClock = { inputDeliveryAndEditing: bounds(inputDeliveryAndEditing), outputFormattingAndConptyRead: bounds(outputFormattingAndConptyRead), outputReturnToRead: bounds(read - (outputEnd * 1000 / frequency + offset)) }
      const ranges = Object.entries(spans).map(([name, duration]) => ({ name, ...(crossClock[name] ?? { low: duration, high: duration }) }))
      const dominant = ranges.find(candidate => ranges.every(other => candidate === other || candidate.low > other.high))
      return { probeId: id, totalMs: samples.get(id).inputToBufferMs, stagesMs: spans, largestStage: dominant?.name ?? 'ambiguous', writeOutputCallMs: (outputEnd - outputStart) * 1000 / frequency, crossClock }
    })
    const counts = {}
    for (const command of commands) counts[command.largestStage] = (counts[command.largestStage] ?? 0) + 1
    result.set(batch.name, { clock: { uncertaintyMs, offsetDriftMs }, largestStageCounts: counts, commands,
      stagesMs: Object.fromEntries(Object.keys(commands[0].stagesMs).map(stage => [stage, quantiles(commands.map(command => command.stagesMs[stage]))])),
      writeOutputCallMs: quantiles(commands.map(command => command.writeOutputCallMs)),
    })
  }
  return result
}

export function analyzeReport(raw) {
  assert.equal(raw.report.status, 'ok', 'A failed benchmark cannot supply latency evidence')
  const shell = shellTraces(raw)
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
      ...(shell.has(phase.name) ? { shellTrace: shell.get(phase.name) } : {}),
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
