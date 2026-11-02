import { describe, expect, it } from 'vitest'
import type { Collection, TerminalSession } from '../../../store/sessionStore'
import { searchSessions } from '../sessionQuery'

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
