import type { CellSize } from './iipParser'



   

export interface IipOverlayItem {
                                                                  
  id: number
                                                     
  key: string
                            
  dataUrl: string
                                                   
  bufferY: number
                                                         
  col: number
  rows: number
  cols: number
                                                  
  fromSlot?: boolean
                                                                            
  slot: string

                                                                         
  slotRow: number
  slotCol: number
}

export interface Anchor {
                                                                           
  topY: number
                                                                              
  col: number
  fromSlot: boolean
}


   
export function resolveAnchor(
  hit: { row: number; col: number } | null,
  lines: readonly string[],
  cursorAbs: number,
  rows: number
): Anchor {
  if (hit) {
    let blank = 0
    const start = hit.row - rows + 1
    for (let r = start; r < hit.row; r++) {
      if (r >= 0 && (lines[r] ?? '').trim() === '') blank++
    }
    const blockBottom = blank >= Math.max(1, rows - 1)
    const topY = blockBottom ? start : hit.row
    return { topY, col: blockBottom ? 0 : hit.col, fromSlot: true }
  }
  return { topY: cursorAbs, col: 0, fromSlot: false }
}

                                                                          
export function isIipSlotPresent(
  lines: readonly string[],
  item: { slotRow: number; slotCol: number; slot: string }
): boolean {
  return (lines[item.slotRow] ?? '').charAt(item.slotCol) === item.slot
}


   
export const FALLBACK_CACHE_LIMIT = 20


export function commitIipPlacement(
  prev: readonly IipOverlayItem[],
  next: IipOverlayItem,
  lines: readonly string[]
): IipOverlayItem[] {

  const erased = prev.find((x) => x.key === next.key && !isIipSlotPresent(lines, x))
  if (erased) {
    return prev.map((x) => (x.id === erased.id ? { ...next, id: erased.id } : x))
  }
  const id = prev.reduce((m, x) => Math.max(m, x.id), 0) + 1
  const placed = [...prev, { ...next, id }]
  if (next.fromSlot !== false) return placed
  const anchored: IipOverlayItem[] = []
  const fallback: IipOverlayItem[] = []
  for (const x of placed) (x.fromSlot === false ? fallback : anchored).push(x)
  const kept = fallback.length > FALLBACK_CACHE_LIMIT ? fallback.slice(-FALLBACK_CACHE_LIMIT) : fallback
  return [...anchored, ...kept]
}


   
export const FALLBACK_CELL_SIZE: CellSize = { widthPx: 9, heightPx: 18 }

type RenderServiceProbe = {
  _core?: {
    _renderService?: {
      dimensions?: { css?: { cell?: { width?: unknown; height?: unknown } } }
    }
  }
}

function positiveNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

export function readCellSize(term: unknown): CellSize | null {
  const cell = (term as RenderServiceProbe | null | undefined)?._core?._renderService?.dimensions?.css?.cell
  const widthPx = positiveNumber(cell?.width)
  const heightPx = positiveNumber(cell?.height)
  if (widthPx === null || heightPx === null) return null
  return { widthPx, heightPx }
}

export function buildSlotEraseSequence(
  slot: { row: number; col: number },
  viewport: { topY: number; rows: number; cols: number }
): string | null {
  const row = slot.row - viewport.topY
  if (row < 0 || row >= viewport.rows) return null
  if (slot.col < 0 || slot.col >= viewport.cols) return null
  return `\x1b7\x1b[${row + 1};${slot.col + 1}H\x1b[1X\x1b8`
}


export function isStaleIipGeneration(captured: number, current: number): boolean {
  return captured !== current
}
