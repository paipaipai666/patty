export type NoticeKind = 'approval' | 'input' | 'error'
export type AttentionNotice = { paneId: string; title: string; kind: NoticeKind } & (
  | { source: 'agent'; revision: number }
  | { source: 'program'; revision: number; runId: string }
)
export type DesktopActivation = { kind: 'app' } | { kind: 'session'; sessionId: string }

export function parseDesktopActivation(value: unknown): DesktopActivation | null {
  if (typeof value !== 'object' || value === null || !('kind' in value)) return null
  if (value.kind === 'app') return { kind: 'app' }
  if (value.kind === 'session' && 'sessionId' in value && typeof value.sessionId === 'string'
    && /^[A-Za-z0-9_-]{1,128}$/.test(value.sessionId)) return { kind: 'session', sessionId: value.sessionId }
  return null
}
