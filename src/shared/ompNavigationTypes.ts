export interface NavigationTurn {
  entryId: string
  ordinal: number
  preview: string
  createdAt: number
}

export interface NavigationScope {
  scopeId: string
  controlEpoch: number
}

export type NavigationTarget = { kind: 'turn'; entryId: string } | { kind: 'live' }

interface NavigationPositionBase {
  sessionId: string
  branchEpoch: number
  displayEpoch: number
  viewRevision: number
  frameId: string
}

export type NavigationPosition = NavigationPositionBase & (
  | { mode: 'live' }
  | { mode: 'browsing'; entryId: string; anchor: { partId: string; scalarOffset: number } }
)

export type NavigationRequestStatus =
  | { kind: 'queued' }
  | { kind: 'accepted'; admissionId: string }
  | { kind: 'applied'; position: NavigationPosition; shown: boolean }
  | { kind: 'failed'; error: string }
  | { kind: 'cancelled' | 'superseded' | 'expired' }

export interface NavigationRequestSummary {
  requestId: string
  status: NavigationRequestStatus
  observationTimedOut: boolean
}

export interface NavigationReadySnapshot {
  kind: 'ready'
  paneId: string
  runId: string
  instanceId: string
  sessionId: string
  revision: number
  scope: NavigationScope | null
  branchEpoch: number
  displayEpoch: number
  catalogRevision: number
  position: NavigationPosition
  latestRequest: NavigationRequestSummary | null
  catalogSnapshotId: string
  turnCount: number
  pageSize: number
}

export type NavigationSnapshot = NavigationReadySnapshot | { kind: 'unavailable'; paneId: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown, allowEmpty = false, maxLength = 256): value is string {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || value.length > 0)
}

function isCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export interface HistoryScrollMetrics {
  sessionId: string
  branchEpoch: number
  frameId: string
  entryId: string
  before: number
  total: number
  visible: number
}

export function parseHistoryScrollMetrics(value: unknown): HistoryScrollMetrics | null {
  if (!isRecord(value)) return null
  const { sessionId, branchEpoch, frameId, entryId, before, total, visible } = value
  if (!isId(sessionId, false, 512) || !isCounter(branchEpoch) || !isId(frameId) || !isId(entryId)) return null
  if (!isCounter(before) || !isCounter(total) || !isCounter(visible)) return null
  if (total < 1 || before > total) return null
  return { sessionId, branchEpoch, frameId, entryId, before, total, visible }
}

export function parseNavigationPosition(value: unknown): NavigationPosition | null {
  if (!isRecord(value)) return null
  const { sessionId, branchEpoch, displayEpoch, viewRevision, frameId } = value
  if (!isId(sessionId, false, 512) || !isCounter(branchEpoch) || !isCounter(displayEpoch) || !isCounter(viewRevision) || !isId(frameId, true)) return null
  const base = { sessionId, branchEpoch, displayEpoch, viewRevision, frameId }
  if (value.mode === 'live') return { mode: 'live', ...base }
  if (value.mode !== 'browsing' || !isId(value.entryId) || !isRecord(value.anchor)) return null
  const { partId, scalarOffset } = value.anchor
  if (!isId(partId) || !isCounter(scalarOffset)) return null
  return { mode: 'browsing', ...base, entryId: value.entryId, anchor: { partId, scalarOffset } }
}

function parseScope(value: unknown): NavigationScope | null {
  if (!isRecord(value) || !isId(value.scopeId) || !isCounter(value.controlEpoch)) return null
  return { scopeId: value.scopeId, controlEpoch: value.controlEpoch }
}

function parseRequestStatus(value: unknown): NavigationRequestStatus | null {
  if (!isRecord(value)) return null
  switch (value.kind) {
    case 'queued':
    case 'cancelled':
    case 'superseded':
    case 'expired':
      return { kind: value.kind }
    case 'accepted':
      return isId(value.admissionId) ? { kind: 'accepted', admissionId: value.admissionId } : null
    case 'failed':
      return typeof value.error === 'string' && value.error.length <= 4096 ? { kind: 'failed', error: value.error } : null
    case 'applied': {
      const position = parseNavigationPosition(value.position)
      return position && typeof value.shown === 'boolean' ? { kind: 'applied', position, shown: value.shown } : null
    }
    default:
      return null
  }
}

function parseRequest(value: unknown): NavigationRequestSummary | null {
  if (!isRecord(value) || !isId(value.requestId) || typeof value.observationTimedOut !== 'boolean') return null
  const status = parseRequestStatus(value.status)
  return status ? { requestId: value.requestId, status, observationTimedOut: value.observationTimedOut } : null
}

export function parseNavigationSnapshot(value: unknown): NavigationSnapshot | null {
  if (!isRecord(value) || !isId(value.paneId)) return null
  const { paneId } = value
  if (value.kind === 'unavailable') return { kind: 'unavailable', paneId }
  if (value.kind !== 'ready') return null
  const { runId, instanceId, sessionId, revision, branchEpoch, displayEpoch, catalogRevision, catalogSnapshotId, turnCount, pageSize } = value
  if (!isId(runId) || !isId(instanceId) || !isId(sessionId, false, 512) || !isId(catalogSnapshotId) || !isCounter(revision)
    || !isCounter(branchEpoch) || !isCounter(displayEpoch) || !isCounter(catalogRevision)
    || !isCounter(turnCount) || turnCount > 100_000 || !isCounter(pageSize) || pageSize < 1 || pageSize > 1024) return null
  const position = parseNavigationPosition(value.position)
  if (!position || position.sessionId !== sessionId || position.branchEpoch !== branchEpoch || position.displayEpoch !== displayEpoch) return null
  const scope = parseScope(value.scope)
  if (value.scope !== null && !scope) return null
  const latestRequest = parseRequest(value.latestRequest)
  if (value.latestRequest !== null && !latestRequest) return null
  return { kind: 'ready', paneId, runId, instanceId, sessionId, revision, scope, branchEpoch, displayEpoch, catalogRevision, position, latestRequest, catalogSnapshotId, turnCount, pageSize }
}

export function parseNavigationTurns(value: unknown): NavigationTurn[] | null {
  if (!Array.isArray(value) || value.length > 100_000) return null
  const turns: NavigationTurn[] = []
  const ids = new Set<string>()
  let previousOrdinal = 0
  for (const item of value) {
    if (!isRecord(item) || !isId(item.entryId) || !isCounter(item.ordinal) || item.ordinal <= previousOrdinal
      || typeof item.preview !== 'string' || item.preview.length > 4096 || !isCounter(item.createdAt) || item.createdAt > 8.64e15
      || ids.has(item.entryId)) return null
    turns.push({ entryId: item.entryId, ordinal: item.ordinal, preview: item.preview, createdAt: item.createdAt })
    ids.add(item.entryId)
    previousOrdinal = item.ordinal
  }
  return turns
}
