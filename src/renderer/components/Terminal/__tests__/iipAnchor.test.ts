import { describe, it, expect } from 'vitest'
import { resolveAnchor, commitIipPlacement, isIipSlotPresent, type IipOverlayItem } from '../iipAnchor'

function item(over: Partial<IipOverlayItem>): IipOverlayItem {
  return {
    id: 1,
    key: 'k',
    dataUrl: 'data:image/png;base64,x',
    bufferY: 40,
    col: 0,
    rows: 5,
    cols: 10,
    fromSlot: true,
    slot: '@',
    slotRow: 40,
    slotCol: 0,
    ...over,
  }
}

describe('resolveAnchor', () => {
  it('bare IIP at cursor → slot is TOP-LEFT (iTerm2 semantics)', () => {
    // Live Patty: raw OSC 1337 at cursor, hit=(3,0), rows=5 → top must be 3.
    const lines = ['pwd', 'PS> echo iip', 'x', 'SLOT', '', '', '', '']
    const hit = { row: 3, col: 0 }
    const a = resolveAnchor(hit, lines, 3, 5)
    expect(a.topY).toBe(3)
    expect(a.col).toBe(0)
    expect(a.fromSlot).toBe(true)
  })

  it('omp reserved block → slot is BOTTOM (CUU lost in line paint)', () => {
    // 5-row image: 4 blank reserved lines then the IIP line at row 9.
    const lines = Array.from({ length: 15 }, (_, i) => (i >= 5 && i <= 8 ? '' : `text${i}`))
    lines[9] = 'SLOT'
    const hit = { row: 9, col: 0 }
    const a = resolveAnchor(hit, lines, 9, 5)
    expect(a.topY).toBe(9 - 5 + 1) // 5
  })

  it('cursor fallback only when the slot is missing', () => {
    const a = resolveAnchor(null, ['a'], 200, 6)
    expect(a.topY).toBe(200)
    expect(a.fromSlot).toBe(false)
  })
})

describe('isIipSlotPresent', () => {
  it('matches only while the slot glyph still sits at the planted cell', () => {
    const it = item({ slotRow: 2, slotCol: 2, slot: '@' })
    expect(isIipSlotPresent(['', '', 'ab@ef'], it)).toBe(true)
    // erased
    expect(isIipSlotPresent(['', '', 'abxef'], it)).toBe(false)
    // renumbered (row now beyond buffer)
    expect(isIipSlotPresent(['ab@ef'], it)).toBe(false)
  })
})

describe('commitIipPlacement', () => {
  it('appends a never-seen payload', () => {
    const next = commitIipPlacement([], item({ id: 0 }), [])
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe(1)
  })

  it('relocates a repaint: old slot erased → reuse id, move to the new anchor', () => {
    const first = item({ id: 1, bufferY: 40, slot: '@', slotRow: 40, slotCol: 0, key: 'k' })
    // Old slot erased (row 40 beyond the cleared buffer); repaint planted '#' at row 5.
    const lines = Array.from({ length: 30 }, () => '')
    lines[5] = '#'
    const next = commitIipPlacement([first], item({ id: 0, key: 'k', bufferY: 5, slot: '#', slotRow: 5, slotCol: 0 }), lines)
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe(1)
    expect(next[0].bufferY).toBe(5)
    expect(next[0].slot).toBe('#')
  })

  it('keeps both when the same payload is displayed again (old slot intact)', () => {
    const first = item({ id: 1, bufferY: 40, slot: '@', slotRow: 40, slotCol: 0, key: 'k' })
    const lines = Array.from({ length: 80 }, () => '')
    lines[40] = '@' // first display still anchored
    lines[70] = '#'
    const next = commitIipPlacement([first], item({ id: 0, key: 'k', bufferY: 70, slot: '#', slotRow: 70, slotCol: 0 }), lines)
    expect(next).toHaveLength(2)
    expect(next.map((x) => x.id)).toEqual([1, 2])
    expect(next[0].bufferY).toBe(40)
    expect(next[1].bufferY).toBe(70)
  })

  it('relocates the erased display, not an intact one, with multiple same-payload items', () => {
    const first = item({ id: 1, bufferY: 10, slot: '@', slotRow: 10, slotCol: 0, key: 'k' })
    const second = item({ id: 2, bufferY: 40, slot: '#', slotRow: 40, slotCol: 0, key: 'k' })
    const lines = Array.from({ length: 80 }, () => '')
    lines[10] = '@' // first display intact
    lines[40] = '' // second slot erased (e.g. line cleared)
    lines[55] = '$' // repaint planted the slot at row 55
    const next = commitIipPlacement(
      [first, second],
      item({ id: 0, key: 'k', bufferY: 55, slot: '$', slotRow: 55, slotCol: 0 }),
      lines
    )
    expect(next).toHaveLength(2)
    expect(next[0].bufferY).toBe(10) // untouched
    expect(next[1].id).toBe(2) // id reused, no remount flicker
    expect(next[1].bufferY).toBe(55)
  })

  it('allocates ids above the existing max', () => {
    const prev = [item({ id: 7, key: 'a' }), item({ id: 3, key: 'b' })]
    const next = commitIipPlacement(prev, item({ id: 0, key: 'c' }), [])
    expect(next[2].id).toBe(8)
  })
})
