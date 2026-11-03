import type { TerminalSession } from '../store/sessionStore'
import { AGENT_LABELS } from '../../shared/agentTypes'
import { SHELL_LABELS } from '../../shared/settingsTypes'

export function sessionLocation(session: TerminalSession): string {
  if (session.shell === 'ssh' && session.ssh) {
    const { host, user, port } = session.ssh
    const address = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
    return `${user ? `${user}@` : ''}${address}${port && port !== 22 ? `:${port}` : ''}`
  }
  return session.cwd || 'Home directory'
}

export function sessionContext(session: TerminalSession): string {
  const tool = session.aiType ? AGENT_LABELS[session.aiType] : SHELL_LABELS[session.shell]
  const directory = session.cwd.replace(/\\/g, '/').split('/').filter(Boolean).at(-1)
  const location = session.shell === 'ssh' ? sessionLocation(session) : directory
  return location ? `${tool} · ${location}` : tool
}
