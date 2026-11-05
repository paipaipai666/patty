import { describe, expect, it } from 'vitest'
import { notificationChanges } from '../desktopNotifications'
import { parseDesktopActivation } from '../../../shared/desktopNotifications'
import { programSession } from '../../../shared/programTypes'

const empty = { loaded: true, sessions: [{ id: 'p1', title: 'Build' }], agentStates: {}, agentRevisions: {}, programStates: {} }
const waiting = { ...empty, agentStates: { p1: { status: 'waiting_input' as const, unread: true } }, agentRevisions: { p1: 3 } }

describe('desktop notifications', () => {
  it('delivers a new attention edge and ignores initial snapshots, read changes, and duplicate revisions', () => {
    expect(notificationChanges(waiting, empty).notices).toEqual([{ paneId: 'p1', title: 'Build', kind: 'input', source: 'agent', revision: 3 }])
    expect(notificationChanges(waiting, { ...empty, loaded: false }).notices).toEqual([])
    expect(notificationChanges({ ...waiting, agentStates: { p1: { status: 'waiting_input', unread: false } }, agentRevisions: { p1: 4 } }, waiting).notices).toEqual([])
  })
  it('notifies fresh program edges, never replays hidden reports, and dismisses a Hook takeover', () => {
    const program = programSession({ paneId: 'p1', revision: 3, runId: '1', recordCount: 1, program: { id: '', revision: 1, state: 'blocked', kind: 'auth' } })
    const blocked = { ...empty, programStates: { p1: program } }
    expect(notificationChanges(blocked, empty).notices).toEqual([{ paneId: 'p1', title: 'Build', kind: 'input', source: 'program', revision: 3, runId: '1' }])
    const idleHook = { ...blocked, agentStates: { p1: { status: 'idle' as const, unread: false as const } } }
    expect(notificationChanges(idleHook, blocked)).toEqual({ notices: [], dismiss: ['p1'] })
    expect(notificationChanges(blocked, idleHook)).toEqual({ notices: [], dismiss: [] })
    expect(notificationChanges({ ...blocked, loaded: true }, { ...empty, loaded: false }).notices).toEqual([])
    expect(notificationChanges({ ...blocked, programStates: { p1: { ...program, revision: 4, recordCount: 2 } } }, blocked).notices).toEqual([])
    const updated = programSession({ ...program, revision: 5, program: { id: '', revision: 2, state: 'blocked', kind: 'auth', progress: 40 } }, program)
    expect(notificationChanges({ ...blocked, programStates: { p1: updated } }, blocked).notices).toEqual([])
    expect(notificationChanges(empty, blocked)).toEqual({ notices: [], dismiss: ['p1'] })
  })
  it('dismisses resolved and removed sessions', () => {
    expect(notificationChanges(empty, waiting).dismiss).toEqual(['p1'])
    expect(notificationChanges({ ...empty, sessions: [] }, waiting).dismiss).toEqual(['p1'])
  })
  it('validates native activation payloads', () => {
    expect(parseDesktopActivation({ kind: 'session', sessionId: 'p-1' })).toEqual({ kind: 'session', sessionId: 'p-1' })
    expect(parseDesktopActivation({ kind: 'app' })).toEqual({ kind: 'app' })
    for (const value of [null, { kind: 'other' }, { kind: 'session', sessionId: 'p1?run=exit' }, { kind: 'session', sessionId: '' }]) expect(parseDesktopActivation(value)).toBeNull()
  })
})
