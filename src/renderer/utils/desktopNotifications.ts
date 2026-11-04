import type { AgentStates } from '../../shared/agentTypes'
import type { NoticeKind } from '../../shared/desktopNotifications'

interface Snapshot {
  loaded: boolean
  sessions: ReadonlyArray<{ id: string; title: string }>
  agentStates: AgentStates
  agentRevisions: Readonly<Record<string, number | undefined>>
}

export function notificationChanges(next: Snapshot, previous: Snapshot) {
  const notices: Array<{ paneId: string; title: string; kind: NoticeKind; revision: number }> = []
  const dismiss: string[] = []
  if (!previous.loaded || !next.loaded) return { notices, dismiss }
  for (const session of next.sessions) {
    const status = next.agentStates[session.id]?.status
    const before = previous.agentStates[session.id]?.status
    if (status === before) continue
    const kind = status === 'waiting_approval' ? 'approval' : status === 'waiting_input' ? 'input' : status === 'error' ? 'error' : null
    const revision = next.agentRevisions[session.id]
    if (kind && revision) notices.push({ paneId: session.id, title: session.title, kind, revision })
    else if (before === 'waiting_approval' || before === 'waiting_input' || before === 'error') dismiss.push(session.id)
  }
  const ids = new Set(next.sessions.map(session => session.id))
  for (const session of previous.sessions) if (!ids.has(session.id)) dismiss.push(session.id)
  return { notices, dismiss }
}
