import { describe, expect, it } from 'vitest'
import type { TerminalSession } from '../../store/sessionStore'
import { sessionContext, sessionLocation } from '../sessionPresentation'

const session: TerminalSession = { id: 'p1', title: 'Task', color: 'blue', cwd: '', shell: 'powershell', pid: 0, createdAt: 1, collectionId: null }

describe('session presentation', () => {
  it('shows the tool and working folder with either path separator', () => {
    expect(sessionContext({ ...session, aiType: 'claude', cwd: 'D:\\code\\patty\\' })).toBe('Claude Code · patty')
    expect(sessionContext({ ...session, aiType: 'codex', cwd: '/home/dev/payments/' })).toBe('Codex · payments')
    expect(sessionLocation({ ...session, cwd: 'D:\\code\\patty' })).toBe('D:\\code\\patty')
  })

  it('keeps a complete SSH target, including custom ports and IPv6 brackets', () => {
    expect(sessionContext({ ...session, shell: 'ssh', ssh: { host: 'prod-01', user: 'deploy', port: 2222 } })).toBe('SSH · deploy@prod-01:2222')
    expect(sessionLocation({ ...session, shell: 'ssh', ssh: { host: '::1', port: 22 } })).toBe('[::1]')
    expect(sessionLocation({ ...session, shell: 'ssh', ssh: { host: '[::1]', port: 2222 } })).toBe('[::1]:2222')
  })

  it('uses a readable shell context when no directory has been reported', () => {
    expect(sessionContext(session)).toBe('Windows PowerShell')
    expect(sessionLocation(session)).toBe('Home directory')
  })
})
