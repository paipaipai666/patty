import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeReport } from './analyze-terminal-latency.mjs'

function fixture() {
  return { environment: { executableHash: 'same-build' }, samples: [{ at: 900 }, { at: 1000 }, { at: 1100 }], report: { status: 'ok',
    ptyOutput: { inputReceivedMarkers: { 7: 1001, 8: 1010 }, inputQueuedMarkers: { 7: 1002, 8: 1011 },
      inputWriteMarkers: { 7: 1003, 8: 1012 }, inputWrittenMarkers: { 7: 1004, 8: 1013 },
      readMarkers: { 7: 1030, 8: 1014 }, markers: { 7: 1032, 8: 1015 } },
    phases: [{ name: 'background-output', startedAt: 950, endedAt: 1090, data: [
      { probeId: 7, sentAt: 1000, inputToReceiptMs: 35, inputToBufferMs: 40 },
      { probeId: 8, sentAt: 1000, inputToReceiptMs: 16, inputToBufferMs: 17 },
    ] }, { name: 'switch', data: [3, 4] }],
  } }
}

test('counts the dominant actor per actual command and keeps stage percentiles separate', () => {
  const result = analyzeReport(fixture())
  assert.deepEqual(result.samplerIntervalMs, { samples: 2, p50: 100, p95: 100, max: 100 })
  assert.equal(result.phases.length, 1)
  const phase = result.phases[0]
  assert.deepEqual(phase.largestStageCounts, { childAndConpty: 1, inputToRust: 1 })
  assert.deepEqual(phase.inputMs, { samples: 2, p50: 17, p95: 40, max: 40 })
  assert.equal(phase.resourceSamples, 1)
  assert.equal(phase.slowest[0].index, 0)
  assert.deepEqual(phase.slowest[0].stagesMs, { inputToRust: 1, rustToQueue: 1, queueToWrite: 1, write: 1, childAndConpty: 26, outputBatch: 2, outputIPC: 3, parse: 5 })
})

test('rejects missing and invalid timing pairs rather than dropping slow samples', () => {
  const missing = fixture()
  delete missing.report.ptyOutput.readMarkers[7]
  assert.throws(() => analyzeReport(missing), /Missing paired timestamps for probe 7/)
  const absentReceipt = fixture()
  absentReceipt.report.phases[0].data[0].inputToReceiptMs = null
  assert.throws(() => analyzeReport(absentReceipt), /Missing paired timestamps for probe 7/)
  const reversed = fixture()
  reversed.report.ptyOutput.inputWrittenMarkers[7] = 1040
  assert.throws(() => analyzeReport(reversed), /Out-of-order childAndConpty/)
  const failed = fixture()
  failed.report.status = 'error'
  assert.throws(() => analyzeReport(failed), /failed benchmark/)
})

function tracedFixture() {
  const raw = fixture()
  raw.report.phases[0].name = 'shell-trace-recorded-input'
  raw.report.shellTraces = [{ name: 'shell-trace-recorded-input', frequency: 1000,
    clockBefore: [900, 900, 900], clockAfter: [1100, 1100, 1100],
    rows: [[7, 1010, 1011, 1013, 1018, 1019, 1025], [8, 1013.5, 1013.5, 1013.5, 1013.5, 1013.5, 1016]],
  }]
  return raw
}

test('splits Shell spans without treating an overlapping output call as a serial stage', () => {
  const phase = analyzeReport(tracedFixture()).phases[0]
  assert.deepEqual(phase.shellTrace.clock, { uncertaintyMs: 0, offsetDriftMs: 0 })
  assert.deepEqual(phase.shellTrace.largestStageCounts, { outputFormattingAndConptyRead: 1, ambiguous: 1 })
  const command = phase.shellTrace.commands[0]
  assert.deepEqual(command.stagesMs, { inputDeliveryAndEditing: 6, editorToClassification: 1, classification: 2,
    classificationToExecution: 5, executionToOutputCall: 1, outputFormattingAndConptyRead: 11 })
  assert.equal(command.writeOutputCallMs, 6)
  assert.deepEqual(command.crossClock, { inputDeliveryAndEditing: { low: 6, high: 6 }, outputFormattingAndConptyRead: { low: 11, high: 11 }, outputReturnToRead: { low: 5, high: 5 } })
  assert.deepEqual(phase.shellTrace.commands[1].crossClock.outputReturnToRead, { low: -2, high: -2 })
})

test('retains clock uncertainty and does not clamp a boundary that straddles zero', () => {
  const raw = tracedFixture()
  raw.report.shellTraces[0].clockBefore = [899, 900, 901]
  raw.report.shellTraces[0].clockAfter = [1099, 1100, 1101]
  raw.report.shellTraces[0].rows[1][1] = 1012.5
  const trace = analyzeReport(raw).phases[0].shellTrace
  assert.equal(trace.clock.uncertaintyMs, 1)
  assert.equal(trace.commands[1].stagesMs.inputDeliveryAndEditing, -0.5)
  assert.deepEqual(trace.commands[1].crossClock.inputDeliveryAndEditing, { low: -1.5, high: 0.5 })
})

test('rejects incomplete, duplicate, oversized and out-of-window Shell evidence', () => {
  const cases = [
    raw => { delete raw.report.shellTraces },
    raw => { raw.report.shellTraces[0] = null },
    raw => { raw.report.shellTraces.push(raw.report.shellTraces[0]) },
    raw => { raw.report.shellTraces[0].rows.pop() },
    raw => { raw.report.shellTraces[0].rows[1][0] = 7 },
    raw => { raw.report.shellTraces[0].rows[0][2] = 0 },
    raw => { raw.report.shellTraces[0].rows[0][3] = 1010 },
    raw => { raw.report.shellTraces[0].clockBefore[2] = 899 },
    raw => { raw.report.shellTraces[0].clockAfter[0] = 1020 },
    raw => { raw.report.shellTraces[0].frequency = 0 },
    raw => { raw.report.shellTraces[0].rows[0][5] = 1040; raw.report.shellTraces[0].rows[0][6] = 1041 },
    raw => { raw.report.shellTraces[0].rows = Array.from({ length: 257 }, () => raw.report.shellTraces[0].rows[0]) },
    raw => { raw.report.shellTraces[0].unexpected = 'x'.repeat(65537) },
  ]
  for (const mutate of cases) {
    const raw = tracedFixture()
    mutate(raw)
    assert.throws(() => analyzeReport(raw), /Shell trace/)
  }
})
