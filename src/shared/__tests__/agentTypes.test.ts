import { describe, expect, it } from 'vitest'
import { activityFromStatus, parseAgentUpdate } from '../agentTypes'

describe('agent update boundary', () => {
  it('parses all supported runtime states and an explicit session clear', () => {
    for (const status of ['idle', 'working', 'waiting_approval', 'waiting_input', 'complete', 'error']) {
      expect(parseAgentUpdate({ paneId: 'p1', agent: { aiType: 'codex', status } })).toEqual({
        paneId: 'p1', agent: { aiType: 'codex', status }
      })
    }
    expect(parseAgentUpdate({ paneId: 'p1', agent: null })).toEqual({ paneId: 'p1', agent: null })
  })

  it('rejects old tuples, unknown agent types, missing fields and invalid states', () => {
    for (const value of [null, [], ['p1', 'permission', 'claude'], {},
      { paneId: '', agent: null }, { paneId: 'p1' },
      { paneId: 'p1', agent: { aiType: 'unknown', status: 'working' } },
      { paneId: 'p1', agent: { aiType: 'claude', status: 'unknown' } },
      { paneId: 'p1', agent: { aiType: 'claude' } }]) {
      expect(parseAgentUpdate(value)).toBeNull()
    }
    expect(parseAgentUpdate({ paneId: 'p1', agent: { aiType: 'claude', status: 'working' } })).toEqual({
      paneId: 'p1', agent: { aiType: 'claude', status: 'working' }
    })
  })

  it('only actionable states and completed results can be unread', () => {
    expect(activityFromStatus('working')).toEqual({ status: 'working', unread: false })
    expect(activityFromStatus('idle')).toEqual({ status: 'idle', unread: false })
    expect(activityFromStatus('waiting_input')).toEqual({ status: 'waiting_input', unread: true })
    expect(activityFromStatus('complete', false)).toEqual({ status: 'complete', unread: false })
  })
})
