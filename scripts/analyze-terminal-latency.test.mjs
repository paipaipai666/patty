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
  const reversed = fixture()
  reversed.report.ptyOutput.inputWrittenMarkers[7] = 1040
  assert.throws(() => analyzeReport(reversed), /Out-of-order childAndConpty/)
  const failed = fixture()
  failed.report.status = 'error'
  assert.throws(() => analyzeReport(failed), /failed benchmark/)
})
