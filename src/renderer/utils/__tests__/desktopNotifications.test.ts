import { describe, expect, it } from 'vitest'
import { notificationChanges } from '../desktopNotifications'
import { parseDesktopActivation } from '../../../shared/desktopNotifications'

const empty = { loaded: true, sessions: [{ id: 'p1', title: 'Build' }], agentStates: {}, agentRevisions: {} }
const waiting = { ...empty, agentStates: { p1: { status: 'waiting_input' as const, unread: true } }, agentRevisions: { p1: 3 } }

describe('desktop notifications', () => {
  it('delivers a new attention edge and ignores initial snapshots, read changes, and duplicate revisions', () => {
    expect(notificationChanges(waiting, empty).notices).toEqual([{ paneId: 'p1', title: 'Build', kind: 'input', revision: 3 }])
    expect(notificationChanges(waiting, { ...empty, loaded: false }).notices).toEqual([])
    expect(notificationChanges({ ...waiting, agentStates: { p1: { status: 'waiting_input', unread: false } }, agentRevisions: { p1: 4 } }, waiting).notices).toEqual([])
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
