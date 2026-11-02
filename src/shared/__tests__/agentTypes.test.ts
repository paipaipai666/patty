import { describe, expect, it } from 'vitest'
import { activityFromStatus, parseAgentSnapshot, parseAgentUpdate } from '../agentTypes'

describe('agent update boundary', () => {
  it('parses all supported runtime states and an explicit session clear', () => {
    for (const status of ['unknown', 'idle', 'working', 'waiting_approval', 'waiting_input', 'complete', 'error']) {
      expect(parseAgentUpdate({ paneId: 'p1', revision: 1, agent: { aiType: 'codex', status } })).toEqual({
        paneId: 'p1', revision: 1, agent: { aiType: 'codex', status }
      })
    }
    expect(parseAgentUpdate({ paneId: 'p1', revision: 1, agent: null })).toEqual({ paneId: 'p1', revision: 1, agent: null })
  })

  it('rejects old tuples, unknown agent types, missing fields and invalid states', () => {
    for (const value of [null, [], ['p1', 'permission', 'claude'], {},
      { paneId: '', agent: null }, { paneId: 'p1' },
      { paneId: 'p1', revision: 1, agent: { aiType: 'unknown', status: 'working' } },
      { paneId: 'p1', revision: 1, agent: { aiType: 'claude', status: 'invented' } },
      { paneId: 'p1', revision: 1, agent: { aiType: 'claude' } }]) {
      expect(parseAgentUpdate(value)).toBeNull()
    }
    expect(parseAgentUpdate({ paneId: 'p1', revision: 1, agent: { aiType: 'claude', status: 'working' } })).toEqual({
      paneId: 'p1', revision: 1, agent: { aiType: 'claude', status: 'working' }
    })
  })

  it('only actionable states and completed results can be unread', () => {
    expect(activityFromStatus('working')).toEqual({ status: 'working', unread: false })
    expect(activityFromStatus('idle')).toEqual({ status: 'idle', unread: false })
    expect(activityFromStatus('unknown')).toEqual({ status: 'unknown', unread: false })
    expect(activityFromStatus('waiting_input')).toEqual({ status: 'waiting_input', unread: true })
    expect(activityFromStatus('complete', false)).toEqual({ status: 'complete', unread: false })
  })

  it('requires positive safe integer update revisions', () => {
    for (const revision of [undefined, null, 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseAgentUpdate({ paneId: 'p1', revision, agent: null })).toBeNull()
    }
  })

  it('validates snapshot revisions, unique panes and active states', () => {
    const update = { paneId: 'p1', revision: 3, agent: { aiType: 'codex', status: 'working' } }
    expect(parseAgentSnapshot({ revision: 5, agents: [update] })).toEqual({ revision: 5, agents: [update] })
    expect(parseAgentSnapshot({ revision: 5, agents: [] })).toEqual({ revision: 5, agents: [] })
    for (const snapshot of [null, {}, { revision: -1, agents: [] }, { revision: 1.5, agents: [] },
      { revision: 5, agents: [update, update] }, { revision: 2, agents: [update] },
      { revision: 5, agents: [{ paneId: 'p1', revision: 3, agent: null }] }]) {
      expect(parseAgentSnapshot(snapshot)).toBeNull()
    }
  })
})
