import { SHELL_LABELS } from '../../../shared/settingsTypes'
import type { Collection, TerminalSession } from '../../store/sessionStore'

export type SessionView = 'all' | 'attention' | 'complete'

type AttentionMap = Readonly<Record<string, string | null>>

function attentionView(event: string | null | undefined): Exclude<SessionView, 'all'> | null {
  if (event === 'permission' || event === 'error') return 'attention'
  if (event === 'complete') return 'complete'
  return null
}

export function filterSessionsByAttention({ sessions, attentionMap, view }: {
  sessions: TerminalSession[]
  attentionMap: AttentionMap
  view: SessionView
}): TerminalSession[] {
  if (view === 'all') return sessions
  return sessions.filter((session) => attentionView(attentionMap[session.id]) === view)
}

export function countSessionViews(sessions: TerminalSession[], attentionMap: AttentionMap): Record<SessionView, number> {
  const counts = { all: sessions.length, attention: 0, complete: 0 }
  for (const session of sessions) {
    const view = attentionView(attentionMap[session.id])
    if (view) counts[view]++
  }
  return counts
}

const AGENT_LABELS: Record<NonNullable<TerminalSession['aiType']>, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  omp: 'Oh My Pi omp',
  qwen: 'Qwen Code',
  copilot: 'GitHub Copilot CLI'
}

function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replaceAll('\\', '/')
}

function collectionNames(id: string | null, collections: Map<string, Collection>): string[] {
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
