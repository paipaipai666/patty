
   

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
  return [...prev, { ...next, id }]
}


   
export function isStaleIipGeneration(captured: number, current: number): boolean {
  return captured !== current
}
