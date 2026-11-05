import type { AgentStates } from '../../shared/agentTypes'
import type { AttentionNotice, NoticeKind } from '../../shared/desktopNotifications'
import { effectiveActivity, type ProgramStates } from '../../shared/programTypes'

interface Snapshot {
  loaded: boolean
  sessions: ReadonlyArray<{ id: string; title: string }>
  agentStates: AgentStates
  agentRevisions: Readonly<Record<string, number | undefined>>
  programStates: ProgramStates
}

function noticeKind(status: string | undefined): NoticeKind | null {
  return status === 'waiting_approval' ? 'approval' : status === 'waiting_input' ? 'input' : status === 'error' ? 'error' : null
}

export function notificationChanges(next: Snapshot, previous: Snapshot) {
  const notices: AttentionNotice[] = []
  const dismiss: string[] = []
  if (!previous.loaded || !next.loaded) return { notices, dismiss }
  for (const session of next.sessions) {
    const agent = next.agentStates[session.id]
    const oldAgent = previous.agentStates[session.id]
    const program = next.programStates[session.id]
    const oldProgram = previous.programStates[session.id]
    const kind = noticeKind(effectiveActivity(agent, program)?.status)
    const before = noticeKind(effectiveActivity(oldAgent, oldProgram)?.status)
    const sourceChanged = Boolean(agent) !== Boolean(oldAgent) || (!agent && program?.runId !== oldProgram?.runId)
    if (before && (!kind || before !== kind || sourceChanged)) dismiss.push(session.id)
    if (!kind) continue
    if (agent) {
      const revision = next.agentRevisions[session.id]
      if (agent.status !== oldAgent?.status && revision) notices.push({ paneId: session.id, title: session.title, kind, source: 'agent', revision })
    } else if (program?.program && program.revision !== oldProgram?.revision) {
      const record = program.program
      const previousRecord = oldProgram?.program
      const fresh = program.runId !== oldProgram?.runId || record.revision > (previousRecord?.revision ?? 0)
      const changed = record.state !== previousRecord?.state || record.id !== previousRecord?.id
        || (record.state === 'blocked' && previousRecord?.state === 'blocked' && record.kind !== previousRecord.kind)
      if (fresh && changed) notices.push({ paneId: session.id, title: session.title, kind, source: 'program', revision: program.revision, runId: program.runId })
    }
  }
  const ids = new Set(next.sessions.map(session => session.id))
  for (const session of previous.sessions) if (!ids.has(session.id)) dismiss.push(session.id)
  return { notices, dismiss }
}
