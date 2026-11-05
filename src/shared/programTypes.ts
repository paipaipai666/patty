import { activityFromStatus, type AgentActivity } from './agentTypes'

interface ProgramFields {
  id: string
  revision: number
  app?: string
  title?: string
  message?: string
}

export type ProgramRecord = ProgramFields & (
  | { state: 'idle' }
  | { state: 'done' }
  | { state: 'error' }
  | { state: 'working'; progress?: number }
  | { state: 'blocked'; kind?: 'permission' | 'question' | 'auth'; progress?: number }
)

export interface ProgramUpdate {
  paneId: string
  revision: number
  runId: string
  program: ProgramRecord | null
  recordCount: number
}

export interface ProgramBatch {
  revision: number
  programs: ProgramUpdate[]
}

export interface ProgramSession extends ProgramUpdate {
  readThrough: number
  activity: AgentActivity | undefined
}

export type ProgramStates = Readonly<Record<string, ProgramSession | undefined>>

function revision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function optionalText(value: object, key: string, limit: number): string | undefined | null {
  if (!(key in value)) return undefined
  const text: unknown = Reflect.get(value, key)
  return typeof text === 'string' && text.length <= limit ? text : null
}

function parseProgramRecord(value: unknown): ProgramRecord | null {
  if (typeof value !== 'object' || value === null || !('revision' in value) || !revision(value.revision)
    || !('id' in value) || typeof value.id !== 'string' || value.id.length > 128
    || (value.id !== '' && (value.id.split('/').length > 8 || !value.id.split('/').every(segment => /^[A-Za-z0-9_.+-]{1,32}$/.test(segment))))
    || !('state' in value)) return null
  const app = optionalText(value, 'app', 32)
  const title = optionalText(value, 'title', 192)
  const message = optionalText(value, 'message', 2048)
  if (app === null || title === null || message === null) return null
  const fields = { id: value.id, revision: value.revision, ...(app !== undefined && { app }), ...(title !== undefined && { title }), ...(message !== undefined && { message }) }
  const progress = 'progress' in value ? value.progress : undefined
  if (progress !== undefined && (typeof progress !== 'number' || !Number.isInteger(progress) || progress < 0 || progress > 100)) return null
  switch (value.state) {
    case 'idle': case 'done': case 'error':
      return progress === undefined && !('kind' in value) ? { ...fields, state: value.state } : null
    case 'working':
      return !('kind' in value) ? { ...fields, state: value.state, ...(typeof progress === 'number' && { progress }) } : null
    case 'blocked': {
      const kind = 'kind' in value ? value.kind : undefined
      if (kind !== undefined && kind !== 'permission' && kind !== 'question' && kind !== 'auth') return null
      return { ...fields, state: value.state, ...(typeof progress === 'number' && { progress }), ...(kind !== undefined && { kind }) }
    }
    default: return null
  }
}

export function parseProgramBatch(value: unknown): ProgramBatch | null {
  if (typeof value !== 'object' || value === null || !('revision' in value) || typeof value.revision !== 'number'
    || !Number.isSafeInteger(value.revision) || value.revision < 0 || !('programs' in value) || !Array.isArray(value.programs)) return null
  const programs: ProgramUpdate[] = []
  const panes = new Set<string>()
  for (const raw of value.programs) {
    const item: unknown = raw
    if (typeof item !== 'object' || item === null || !('paneId' in item) || typeof item.paneId !== 'string' || !item.paneId
      || panes.has(item.paneId) || !('revision' in item) || !revision(item.revision) || item.revision > value.revision
      || !('runId' in item) || typeof item.runId !== 'string' || !/^[1-9][0-9]*$/.test(item.runId)
      || !('recordCount' in item) || typeof item.recordCount !== 'number' || !Number.isInteger(item.recordCount) || item.recordCount < 0 || item.recordCount > 256
      || !('program' in item)) return null
    const program = item.program === null ? null : parseProgramRecord(item.program)
    if ((item.program !== null && !program) || (program === null) !== (item.recordCount === 0)) return null
    panes.add(item.paneId)
    programs.push({ paneId: item.paneId, revision: item.revision, runId: item.runId, program, recordCount: item.recordCount })
  }
  return { revision: value.revision, programs }
}

export function programActivity(program: ProgramRecord | null, unread: boolean): AgentActivity | undefined {
  if (!program) return undefined
  switch (program.state) {
    case 'working': case 'idle': return activityFromStatus(program.state)
    case 'done': return activityFromStatus('complete', unread)
    case 'error': return activityFromStatus('error', unread)
    case 'blocked': return activityFromStatus(program.kind === 'permission' ? 'waiting_approval' : 'waiting_input', unread)
    default: { const exhaustive: never = program; return exhaustive }
  }
}

export function programSession(update: ProgramUpdate, previous?: ProgramSession): ProgramSession {
  const readThrough = previous?.runId === update.runId ? previous.readThrough : 0
  return { ...update, readThrough, activity: programActivity(update.program, (update.program?.revision ?? 0) > readThrough) }
}

export function effectiveActivity(agent: AgentActivity | undefined, program: ProgramSession | undefined): AgentActivity | undefined {
  return agent ?? program?.activity
}
