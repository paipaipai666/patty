import { SHELL_LABELS } from '../../../shared/settingsTypes'
import type { Collection, TerminalSession } from '../../store/sessionStore'
import { AGENT_LABELS, type AgentStates, type AgentStatus } from '../../../shared/agentTypes'

export type SessionView = 'all' | 'attention' | 'complete'
export type NoticeView = SessionView

export function noticeSessions(sessions: TerminalSession[], agentStates: AgentStates, view: NoticeView = 'all'): TerminalSession[] {
  if (view !== 'all') return filterSessionsByAttention({ sessions, agentStates, view })
  return sessions.filter(session => {
    const state = agentStates[session.id]
    return attentionView(state?.status) === 'attention' || (state?.status === 'complete' && state.unread)
  })
}

function attentionView(status: AgentStatus | undefined): Exclude<SessionView, 'all'> | null {
  if (status === 'waiting_approval' || status === 'waiting_input' || status === 'error') return 'attention'
  if (status === 'complete') return 'complete'
  return null
}

export function filterSessionsByAttention({ sessions, agentStates, view }: {
  sessions: TerminalSession[]
  agentStates: AgentStates
  view: SessionView
}): TerminalSession[] {
  if (view === 'all') return sessions
  return sessions.filter((session) => attentionView(agentStates[session.id]?.status) === view)
}

export function countSessionViews(sessions: TerminalSession[], agentStates: AgentStates): Record<SessionView, number> {
  const counts = { all: sessions.length, attention: 0, complete: 0 }
  for (const session of sessions) {
    const view = attentionView(agentStates[session.id]?.status)
    if (view) counts[view]++
  }
  return counts
}

export function nextAttentionSessionId({ sessions, agentStates, activeSessionId }: {
  sessions: TerminalSession[]
  agentStates: AgentStates
  activeSessionId: string | null
}): string | null {
  const index = sessions.findIndex((session) => session.id === activeSessionId)
  const ordered = [...sessions.slice(index + 1), ...sessions.slice(0, index + 1)]
  return filterSessionsByAttention({ sessions: ordered, agentStates, view: 'attention' })[0]?.id ?? null
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replaceAll('\\', '/')
}

export function collectionNames(id: string | null, collections: Map<string, Collection>): string[] {
  const names: string[] = []
  const visited = new Set<string>()
  while (id !== null && !visited.has(id)) {
    visited.add(id)
    const collection = collections.get(id)
    if (!collection) break
    names.push(collection.name)
    id = collection.parentId
  }
  return names
}

export function searchSessions({
  sessions,
  collections,
  query = ''
}: {
  sessions: TerminalSession[]
  collections: Collection[]
  query?: string
}): TerminalSession[] {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return sessions
  const byId = new Map(collections.map((collection) => [collection.id, collection]))
  return sessions.filter((session) => {
    const text = normalize([
      session.title,
      session.cwd,
      session.shell,
      SHELL_LABELS[session.shell],
      session.aiType ? AGENT_LABELS[session.aiType] : '',
      session.ssh?.host ?? '',
      session.ssh?.user ?? '',
      session.ssh?.port?.toString() ?? '',
      session.ssh ? `${session.ssh.user}@${session.ssh.host}:${session.ssh.port ?? 22}` : '',
      ...collectionNames(session.collectionId, byId)
    ].join('\n'))
    return words.every((word) => text.includes(word))
  })
}
