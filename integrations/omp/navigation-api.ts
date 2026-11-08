export interface SourceAnchor {
  partId: string
  scalarOffset: number
}

interface PositionIdentity {
  sessionId: string
  branchEpoch: number
  displayEpoch: number
  viewRevision: number
  frameId: string
}

export type TranscriptPosition = PositionIdentity & (
  { mode: 'live' } |
  { mode: 'browsing'; entryId: string; anchor: SourceAnchor }
)

export interface DisplayGuard {
  expectedBranchEpoch?: number
  expectedDisplayEpoch?: number
}

export interface SeekTarget extends DisplayGuard {
  entryId: string
  anchor?: SourceAnchor
}

export interface TurnCatalog {
  sessionId: string
  branchEpoch: number
  catalogRevision: number
  turns: readonly { entryId: string; summary: string; timestamp: number }[]
}

export interface TranscriptCapabilities {
  transcriptNavigation: 1
  catalogSnapshot: 1
  nativeHistoryViewport: 1
  frameObservation: 1
}

export interface TranscriptNavigationApi {
  getCapabilities(): TranscriptCapabilities
  getCatalog(): TurnCatalog
  getPosition(): TranscriptPosition
  seek(target: SeekTarget): Promise<TranscriptPosition>
  returnToLive(target?: DisplayGuard): Promise<TranscriptPosition>
  onPosition(listener: (position: TranscriptPosition) => void): () => void
  onCatalog(listener: (catalog: TurnCatalog) => void): () => void
}

export function scalarToCodeUnit(source: string, scalarOffset: number): number {
  let units = 0
  let scalars = 0
  for (const scalar of source) {
    if (scalars >= scalarOffset) break
    units += scalar.length
    scalars++
  }
  return units
}

export function codeUnitToScalar(source: string, codeUnitOffset: number): number {
  let units = 0
  let scalars = 0
  for (const scalar of source) {
    if (units >= codeUnitOffset) break
    units += scalar.length
    scalars++
  }
  return scalars
}
