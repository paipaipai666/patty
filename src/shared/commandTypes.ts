interface CommandIdentity { runId: string; revision: number }
export type CommandSnapshot = CommandIdentity & (
  | { status: 'unavailable' | 'ready' }
  | { status: 'running'; elapsedMs: number }
  | { status: 'finished'; durationMs: number; exitCode: number | null }
  | { status: 'interrupted'; durationMs: number }
)

function milliseconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export function parseCommandSnapshot(value: unknown): CommandSnapshot | null {
  if (typeof value !== 'object' || value === null || !('runId' in value) || typeof value.runId !== 'string'
    || !/^[1-9][0-9]{0,19}$/.test(value.runId) || !('revision' in value) || !milliseconds(value.revision) || !('status' in value)) return null
  const identity = { runId: value.runId, revision: value.revision }
  if (value.status === 'unavailable' || value.status === 'ready') return { ...identity, status: value.status }
  if (value.status === 'running' && 'elapsedMs' in value && milliseconds(value.elapsedMs)) return { ...identity, status: 'running', elapsedMs: value.elapsedMs }
  if (!('durationMs' in value) || !milliseconds(value.durationMs)) return null
  if (value.status === 'interrupted') return { ...identity, status: 'interrupted', durationMs: value.durationMs }
  if (value.status === 'finished' && 'exitCode' in value && (value.exitCode === null || (typeof value.exitCode === 'number'
    && Number.isInteger(value.exitCode) && value.exitCode >= -2147483648 && value.exitCode <= 2147483647))) return { ...identity, status: 'finished', durationMs: value.durationMs, exitCode: value.exitCode }
  return null
}

export function formatCommandDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`
}
