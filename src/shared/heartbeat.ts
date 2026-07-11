export interface HeartbeatConfig {
  timeoutMs: number
}

export const SOURCE_HEARTBEAT: Record<string, HeartbeatConfig> = {
  opencode: { timeoutMs: 15000 },
  'claude-code': { timeoutMs: 600000 },
  codex: { timeoutMs: 600000 }
}

export function getHeartbeatConfig(source: string | null | undefined): HeartbeatConfig | undefined {
  if (!source) return undefined
  return SOURCE_HEARTBEAT[source]
}
