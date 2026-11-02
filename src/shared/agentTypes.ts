export const AGENT_LABELS = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  omp: 'Oh My Pi omp',
  qwen: 'Qwen Code',
  copilot: 'GitHub Copilot CLI'
}

export type AgentType = keyof typeof AGENT_LABELS

export type AgentStatus = 'idle' | 'working' | 'waiting_approval' | 'waiting_input' | 'complete' | 'error'

export interface AgentUpdate {
  paneId: string
  agent: { aiType: AgentType; status: AgentStatus } | null
}

export type AgentActivity =
  | { status: 'idle' | 'working'; unread: false }
  | { status: 'waiting_approval' | 'waiting_input' | 'complete' | 'error'; unread: boolean }

export type AgentStates = Readonly<Record<string, AgentActivity | undefined>>

export function activityFromStatus(status: AgentStatus, unread = true): AgentActivity {
  return status === 'idle' || status === 'working' ? { status, unread: false } : { status, unread }
}

function isAgentStatus(value: unknown): value is AgentStatus {
  return value === 'idle' || value === 'working' || value === 'waiting_approval'
    || value === 'waiting_input' || value === 'complete' || value === 'error'
}

function isAgentType(value: unknown): value is AgentType {
  return typeof value === 'string' && Object.hasOwn(AGENT_LABELS, value)
}

export function parseAgentUpdate(value: unknown): AgentUpdate | null {
  if (typeof value !== 'object' || value === null || !('paneId' in value)
    || typeof value.paneId !== 'string' || value.paneId.length === 0 || !('agent' in value)) return null
  if (value.agent === null) return { paneId: value.paneId, agent: null }
  const agent = value.agent
  if (typeof agent !== 'object' || !('aiType' in agent) || !isAgentType(agent.aiType)
    || !('status' in agent) || !isAgentStatus(agent.status)) return null
  return { paneId: value.paneId, agent: { aiType: agent.aiType, status: agent.status } }
}
