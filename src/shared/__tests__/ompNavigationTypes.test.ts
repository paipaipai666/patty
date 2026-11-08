import { describe, expect, it } from 'vitest'
import { parseNavigationPosition, parseNavigationSnapshot, parseNavigationTurns } from '../ompNavigationTypes'

describe('OMP navigation payloads', () => {
  it('parses a native browsing position and rejects unsafe offsets or foreign modes', () => {
    const position = {
      mode: 'browsing', sessionId: 'session-1', branchEpoch: 2, displayEpoch: 3,
      viewRevision: 4, frameId: 'frame-1', entryId: 'entry-1',
      anchor: { partId: 'body', scalarOffset: 12 }
    }
    expect(parseNavigationPosition(position)).toEqual(position)
    expect(parseNavigationPosition({ ...position, mode: 'editing' })).toBeNull()
    expect(parseNavigationPosition({ ...position, anchor: { partId: 'body', scalarOffset: Number.MAX_SAFE_INTEGER + 1 } })).toBeNull()
  })

  it('validates a complete snapshot without copying extra authentication fields', () => {
    const snapshot = {
      kind: 'ready', paneId: 'pane-1', runId: 'run-1', instanceId: 'instance-1', sessionId: 'session-1',
      revision: 4, scope: { scopeId: 'scope-1', controlEpoch: 1 }, branchEpoch: 0, displayEpoch: 0,
      catalogRevision: 3, position: { mode: 'live', sessionId: 'session-1', branchEpoch: 0, displayEpoch: 0, viewRevision: 0, frameId: '' },
      latestRequest: null, catalogSnapshotId: 'catalog-1', turnCount: 1, pageSize: 256
    }
    expect(parseNavigationSnapshot({ ...snapshot, leaseToken: 'not-ui-data' })).toEqual(snapshot)
    expect(parseNavigationSnapshot({ ...snapshot, position: { ...snapshot.position, sessionId: 'other-session' } })).toBeNull()
    expect(parseNavigationSnapshot({ ...snapshot, pageSize: 0 })).toBeNull()
  })

  it('rejects invalid dates and duplicate turn identities in directory pages', () => {
    const turn = { entryId: 'entry-1', ordinal: 1, preview: 'Question', createdAt: 100 }
    expect(parseNavigationTurns([turn])).toEqual([turn])
    expect(parseNavigationTurns([turn, turn])).toBeNull()
    expect(parseNavigationTurns([{ ...turn, createdAt: 8.64e15 + 1 }])).toBeNull()
    expect(parseNavigationTurns([{ ...turn, ordinal: -1 }])).toBeNull()
  })
})
