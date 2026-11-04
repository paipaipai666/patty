import { expect, it } from 'vitest'
import { parseCommandSnapshot, formatCommandDuration } from '../commandTypes'

it('validates each command phase and keeps absent results distinct from success', () => {
  expect(parseCommandSnapshot({ runId: '1', revision: 1, status: 'ready' })).toEqual({ runId: '1', revision: 1, status: 'ready' })
  expect(parseCommandSnapshot({ runId: '2', revision: 3, status: 'finished', durationMs: 180, exitCode: null })).toEqual({ runId: '2', revision: 3, status: 'finished', durationMs: 180, exitCode: null })
  expect(parseCommandSnapshot({ runId: '2', revision: 3, status: 'finished', durationMs: 180, exitCode: 7 })?.status).toBe('finished')
  for (const value of [
    null, { runId: 1, revision: 0, status: 'ready' }, { runId: '1', revision: -1, status: 'ready' },
    { runId: '1', revision: 3, status: 'running', elapsedMs: -1 },
    { runId: '1', revision: 3, status: 'finished', durationMs: 180 },
    { runId: '1', revision: 3, status: 'finished', durationMs: 180, exitCode: 2147483648 },
    { runId: '1', revision: 3, status: 'interrupted', durationMs: Infinity },
  ]) expect(parseCommandSnapshot(value)).toBeNull()
})

it('formats durations without hiding subsecond commands', () => {
  expect(formatCommandDuration(18)).toBe('18 ms')
  expect(formatCommandDuration(1250)).toBe('1.25 s')
})
