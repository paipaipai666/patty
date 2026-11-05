import { describe, expect, it } from 'vitest'
import fixtures from '../__fixtures__/program-status.json'
import { effectiveActivity, parseProgramBatch, programSession, type ProgramRecord, type ProgramUpdate } from '../programTypes'

const update: ProgramUpdate = { paneId: 'build', revision: 10, runId: '1', recordCount: 1, program: { id: '', revision: 3, state: 'blocked', kind: 'permission' } }
const batch = { revision: 10, programs: [update] }

describe('program IPC boundary', () => {
  it.each(fixtures)('accepts the Rust parser contract: $name', fixture => {
    const value = { revision: 20, programs: [{ ...update, program: fixture.selected, recordCount: fixture.count }] }
    expect(parseProgramBatch(value)).toEqual(value)
  })
  it('rejects invalid records and entire malformed batches', () => {
    for (const value of [null, { revision: -1, programs: [] }, { ...batch, programs: [update, update] },
      { ...batch, programs: [{ ...update, revision: 11 }] }, { ...batch, programs: [{ ...update, runId: '' }] },
      { ...batch, programs: [{ ...update, recordCount: 257 }] }, { ...batch, programs: [{ ...update, recordCount: 0 }] },
      { ...batch, programs: [{ ...update, program: null }] },
      ...[ { state: 'unknown' }, { state: 'idle', progress: 1 }, { state: 'working', kind: 'auth' }, { state: 'blocked', kind: 'x' },
        { state: 'working', progress: 101 }, { state: 'working', progress: 0.1 }, { state: 'working', message: 1 },
        { state: 'working', title: 'a'.repeat(193) }, { state: 'working', id: '/bad' }, { state: 'error', revision: 0 }
      ].map(program => ({ ...batch, programs: [{ ...update, program: { id: '', revision: 3, ...program } }] }))
    ]) expect(parseProgramBatch(value)).toBeNull()
    expect(parseProgramBatch({ revision: 0, programs: [] })).toEqual({ revision: 0, programs: [] })
    expect(parseProgramBatch({ ...batch, programs: [{ ...update, program: null, recordCount: 0 }] })).not.toBeNull()
  })
})

describe('independent program activity', () => {
  it.each([
    [{ id: '', revision: 3, state: 'idle' }, 'idle', false], [{ id: '', revision: 3, state: 'working', progress: 0 }, 'working', false],
    [{ id: '', revision: 3, state: 'done' }, 'complete', true], [{ id: '', revision: 3, state: 'error' }, 'error', true],
    [{ id: '', revision: 3, state: 'blocked', kind: 'permission' }, 'waiting_approval', true],
    [{ id: '', revision: 3, state: 'blocked', kind: 'auth' }, 'waiting_input', true], [{ id: '', revision: 3, state: 'blocked' }, 'waiting_input', true]
  ] satisfies Array<[ProgramRecord, string, boolean]>)('maps %j to the existing activity vocabulary', (record, status, unread) => {
    const parsed = parseProgramBatch({ ...batch, programs: [{ ...update, program: record }] })
    expect(parsed).not.toBeNull()
    if (!parsed) throw new Error('Expected valid program fixture')
    expect(programSession(parsed.programs[0]).activity).toEqual({ status, unread })
  })
  it('retains read acknowledgments within a run and always gives Hook presence priority', () => {
    const first = programSession(update)
    const read = { ...first, readThrough: 3 }
    const duplicate = programSession({ ...update, revision: 11 }, read)
    expect(duplicate.activity).toEqual({ status: 'waiting_approval', unread: false })
    expect(programSession({ ...update, runId: '12', revision: 12 }, read).activity?.unread).toBe(true)
    expect(effectiveActivity({ status: 'unknown', unread: false }, first)).toEqual({ status: 'unknown', unread: false })
    expect(effectiveActivity({ status: 'idle', unread: false }, first)).toEqual({ status: 'idle', unread: false })
    expect(effectiveActivity(undefined, first)).toEqual({ status: 'waiting_approval', unread: true })
  })
})
