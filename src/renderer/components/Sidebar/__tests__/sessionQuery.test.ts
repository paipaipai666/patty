import { describe, expect, it } from 'vitest'
import type { Collection, TerminalSession } from '../../../store/sessionStore'
import { countSessionViews, filterSessionsByAttention, nextAttentionSessionId, searchSessions } from '../sessionQuery'
import { programSession } from '../../../../shared/programTypes'

function session(id: string, values: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id,
    title: id,
    color: 'blue',
    cwd: '',
    shell: 'pwsh',
    pid: 0,
    createdAt: 1,
    collectionId: null,
    ...values
  }
}

const collections: Collection[] = [
  { id: 'work', name: 'Work', parentId: null, collapsed: true, createdAt: 1 },
  { id: 'api', name: 'Payments API', parentId: 'work', collapsed: true, createdAt: 2 }
]

const sessions = [
  session('backend', { title: 'Server', cwd: 'D:\\work\\payments', collectionId: 'api', aiType: 'codex' }),
  session('remote', { title: 'Logs', shell: 'ssh', ssh: { host: 'prod.example.com', user: 'deploy', port: 2222 } }),
  session('assistant', { title: 'Review', cwd: 'D:\\work\\web', aiType: 'claude' }),
  session('local', { title: 'Scratch', shell: 'powershell' })
]

it('includes program reports in attention navigation but always respects idle Hook presence', () => {
  const programStates = { remote: programSession({ paneId: 'remote', revision: 3, runId: '1', recordCount: 1, program: { id: '', revision: 1, state: 'blocked', kind: 'auth' } }) }
  expect(nextAttentionSessionId({ sessions, agentStates: {}, programStates, activeSessionId: 'backend' })).toBe('remote')
  expect(countSessionViews(sessions, {}, programStates)).toEqual({ all: 4, attention: 1, complete: 0 })
  expect(nextAttentionSessionId({ sessions, agentStates: { remote: { status: 'idle', unread: false } }, programStates, activeSessionId: 'backend' })).toBeNull()
})

function ids(query: string): string[] {
  return searchSessions({ sessions, collections, query }).map((item) => item.id)
}

describe('session search', () => {
  it('keeps all sessions in their original order for an empty query', () => {
    expect(ids(' \t ')).toEqual(['backend', 'remote', 'assistant', 'local'])
  })

  it('finds a session by title without case sensitivity', () => {
    expect(ids('sErVeR')).toEqual(['backend'])
  })

  it('finds a project with either Windows path separator', () => {
    expect(ids('d:/work/payments')).toEqual(['backend'])
    expect(ids('D:\\work\\payments')).toEqual(['backend'])
  })

  it('matches multiple words across project, agent, and parent collection fields', () => {
    expect(ids('work codex payments')).toEqual(['backend'])
    expect(ids('codex web')).toEqual([])
  })

  it('finds sessions in a nested collapsed collection by its names', () => {
    expect(ids('Payments API')).toEqual(['backend'])
    expect(ids('Work Server')).toEqual(['backend'])
  })

  it('finds a remote connection by host, user, and port', () => {
    expect(ids('PROD.EXAMPLE.COM deploy 2222')).toEqual(['remote'])
  })

  it('finds an SSH target in user@host:port notation', () => {
    expect(ids('deploy@prod.example.com:2222')).toEqual(['remote'])
    expect(ids('prod.example.com:2222')).toEqual(['remote'])
  })

  it('finds agent display names and shell names', () => {
    expect(ids('Claude Code')).toEqual(['assistant'])
    expect(ids('PowerShell 7')).toEqual(['backend', 'assistant'])
    expect(ids('ssh')).toEqual(['remote'])
  })

  it('normalizes full-width input without changing session data', () => {
    expect(ids('Ｃｏｄｅｘ')).toEqual(['backend'])
    expect(sessions[0].cwd).toBe('D:\\work\\payments')
  })

  it('keeps unrelated sessions searchable when a collection reference is missing or cyclic', () => {
    const malformed: Collection[] = [
      { id: 'a', name: 'Loop A', parentId: 'b', collapsed: true, createdAt: 1 },
      { id: 'b', name: 'Loop B', parentId: 'a', collapsed: true, createdAt: 1 }
    ]
    const result = searchSessions({
      sessions: [session('cycle', { collectionId: 'a' }), session('missing', { collectionId: 'gone' })],
      collections: malformed,
      query: 'loop b'
    })
    expect(result.map((item) => item.id)).toEqual(['cycle'])
  })
})

describe('session attention views', () => {
  const agentStates = {
    backend: { status: 'waiting_approval', unread: false },
    remote: { status: 'error', unread: true },
    assistant: { status: 'complete', unread: false },
    stale: { status: 'waiting_input', unread: true }
  } satisfies import('../../../../shared/agentTypes').AgentStates

  it('includes waiting and failed sessions in needs attention, preserving sidebar order', () => {
    expect(filterSessionsByAttention({ sessions, agentStates, view: 'attention' }).map((item) => item.id)).toEqual(['backend', 'remote'])
  })

  it('keeps completed results separate from sessions that need input', () => {
    expect(filterSessionsByAttention({ sessions, agentStates, view: 'complete' }).map((item) => item.id)).toEqual(['assistant'])
    expect(countSessionViews(sessions, agentStates)).toEqual({ all: 4, attention: 2, complete: 1 })
  })

  it('combines a project search with an attention view', () => {
    const found = searchSessions({ sessions, collections, query: 'work codex' })
    expect(filterSessionsByAttention({ sessions: found, agentStates, view: 'attention' }).map((item) => item.id)).toEqual(['backend'])
    expect(filterSessionsByAttention({ sessions: found, agentStates, view: 'complete' })).toEqual([])
  })

  it('ignores stale session ids and working sessions when counting or filtering', () => {
    expect(countSessionViews(sessions, { backend: { status: 'working', unread: false }, stale: { status: 'complete', unread: true } })).toEqual({ all: 4, attention: 0, complete: 0 })
    expect(filterSessionsByAttention({ sessions, agentStates: {}, view: 'all' }).map((item) => item.id)).toEqual(['backend', 'remote', 'assistant', 'local'])
  })
})

describe('next attention session', () => {
  const agentStates = {
    backend: { status: 'waiting_approval', unread: false },
    remote: { status: 'error', unread: true },
    assistant: { status: 'complete', unread: true },
    local: { status: 'working', unread: false },
    closed: { status: 'waiting_input', unread: true }
  } satisfies import('../../../../shared/agentTypes').AgentStates

  it('advances in session order and wraps past completed and working sessions', () => {
    expect(nextAttentionSessionId({ sessions, agentStates, activeSessionId: 'backend' })).toBe('remote')
    expect(nextAttentionSessionId({ sessions, agentStates, activeSessionId: 'remote' })).toBe('backend')
    expect(nextAttentionSessionId({ sessions, agentStates, activeSessionId: 'assistant' })).toBe('backend')
  })

  it('starts at the first match when there is no current session', () => {
    expect(nextAttentionSessionId({ sessions, agentStates, activeSessionId: null })).toBe('backend')
    expect(nextAttentionSessionId({ sessions, agentStates, activeSessionId: 'missing' })).toBe('backend')
  })

  it('keeps the sole waiting session available after it has been read', () => {
    expect(nextAttentionSessionId({
      sessions, agentStates: { remote: { status: 'waiting_input', unread: false } }, activeSessionId: 'remote'
    })).toBe('remote')
  })

  it('returns no target when only stale, completed or working states remain', () => {
    expect(nextAttentionSessionId({
      sessions,
      agentStates: {
        closed: { status: 'error', unread: true },
        assistant: { status: 'complete', unread: true },
        backend: { status: 'working', unread: false }
      },
      activeSessionId: 'backend'
    })).toBeNull()
    expect(nextAttentionSessionId({ sessions: [], agentStates, activeSessionId: null })).toBeNull()
  })
})
