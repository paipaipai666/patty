import type { AgentUpdate } from '../agentTypes'

let revision = 0

export function agentUpdate(update: Omit<AgentUpdate, 'revision'>): AgentUpdate {
  return { ...update, revision: ++revision }
}
