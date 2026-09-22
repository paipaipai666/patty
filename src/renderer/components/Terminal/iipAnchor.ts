/**
 * Overlay anchor bookkeeping for inline IIP images.
 *
 * Core invariant: an item is valid only while its `slot` glyph (the PUA
 * marker the extractor planted in the stream) still sits at its anchor cell.
 * Everything derives from slot presence:
 *
 * - Buffer clears (ESC[2J/3J), conversation switches and TUI erases all
 *   destroy slot glyphs → stale items must be pruned, or their absolute
 *   bufferY rows get renumbered under them and images from an older
 *   conversation paint inside the new one.
 * - omp repaints an image by erasing the old slot (CR EL … IIP) → the same
 *   payload re-emitted with its old slot gone is a RELOCATION: reuse the item
 *   id (no <img> remount) and move it. The old slot still present means a
 *   genuine second display of the same bytes → keep both.
 */

export interface IipOverlayItem {
  /** Stable React key — survives re-anchors of the same image. */
  id: number
  /** Dedupe / identity key (payload fingerprint). */
  key: string
  /** data URL for <img>. */
  dataUrl: string
  /** Absolute buffer row of the image top-left. */
  bufferY: number
  /** Buffer column of the image top-left (slot cell). */
  col: number
  rows: number
  cols: number
  /** True when geometry came from a slot cell. */
  fromSlot?: boolean
  /** PUA marker planted in the stream; validity witness for this anchor. */
  slot: string
  /** Exact buffer coords of the slot glyph — may differ from (bufferY, col)
   *  when the anchor heuristic snaps the image left edge to column 0. */
  slotRow: number
  slotCol: number
}

export interface Anchor {
  /** Absolute buffer row of the image **top** (slot bottom − rows + 1). */
  topY: number
  /** Left column — reserved blanks start at 0; CUF(n) is TUI gutter noise. */
  col: number
  fromSlot: boolean
}

/**
 * Overlay origin.
 *
 * iTerm2 draws at the cursor (slot) as TOP-LEFT. omp's line painter drops the
 * `CUU` that would move to the block top, so its slot sits on the IIP line
 * (block BOTTOM) with reserved blanks above. Detect that by looking at the
 * `rows-1` lines above the slot: mostly blank ⇒ treat as bottom.
 */
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

/** True while `item.slot` still sits at the cell where it was planted. */
export function isIipSlotPresent(
  lines: readonly string[],
  item: { slotRow: number; slotCol: number; slot: string }
): boolean {
  return (lines[item.slotRow] ?? '').charAt(item.slotCol) === item.slot
}

/**
 * Insert, relocate, or duplicate — decided by slot presence.
 *
 * - Payload never seen → append.
 * - Same payload, old slot erased → repaint/relocation: reuse the item id
 *   (no remount flicker) and move it to the new anchor.
 * - Same payload, old slot still present → a second live display of the same
 *   bytes (e.g. re-read attachment): keep the old item, append a new one.
 */
export function commitIipPlacement(
  prev: readonly IipOverlayItem[],
  next: IipOverlayItem,
  lines: readonly string[]
): IipOverlayItem[] {
  // Relocate the erased same-payload item if there is one (repaint), even
  // when other live displays of the same bytes still hold their slots.
  const erased = prev.find((x) => x.key === next.key && !isIipSlotPresent(lines, x))
  if (erased) {
    return prev.map((x) => (x.id === erased.id ? { ...next, id: erased.id } : x))
  }
  const id = prev.reduce((m, x) => Math.max(m, x.id), 0) + 1
  return [...prev, { ...next, id }]
}

/**
 * Image.onload must not commit geometry captured against a disposed terminal.
 * `ptyGenerationRef` increments on every startPty / effect recycle.
 */
export function isStaleIipGeneration(captured: number, current: number): boolean {
  return captured !== current
}
