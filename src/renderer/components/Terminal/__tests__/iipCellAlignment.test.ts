import { describe, it, expect } from 'vitest'
import { cellAlignedLines, findIipSlot, type IipCellBuffer } from '../iipParser'
import { isIipSlotPresent } from '../iipAnchor'

const SLOT = ''
const EMOJI = '😀'
const ZWJ_FAMILY = '👨‍👩‍👧'

function row(cells: string[]) {
  return {
    length: cells.length,
    getCell: (x: number) => {
      const chars = cells[x]
      if (chars === undefined) return undefined
      return { getChars: () => chars }
    }
  }
}

function buffer(rows: string[][]): IipCellBuffer {
  return {
    length: rows.length,
    getLine: (index: number) => (rows[index] === undefined ? undefined : row(rows[index]))
  }
}

describe('cellAlignedLines', () => {
  it('maps every cell to exactly one code unit', () => {
    const lines = cellAlignedLines(
      buffer([
        ['a', EMOJI, '', 'b'],
        ['x']
      ])
    )
    expect(lines[0]).toHaveLength(4)
    expect(lines[1]).toHaveLength(1)
  })

  it('keeps a slot at its cell column when a wide glyph precedes it', () => {
    const lines = cellAlignedLines(buffer([['a', EMOJI, '', SLOT]]))
    expect(findIipSlot(lines, SLOT)).toEqual({ row: 0, col: 3 })
  })

  it('keeps a slot at its cell column after a ZWJ cluster in one cell', () => {
    const lines = cellAlignedLines(buffer([['x', ZWJ_FAMILY, '', SLOT]]))
    expect(findIipSlot(lines, SLOT)).toEqual({ row: 0, col: 3 })
  })

  it('keeps slot liveness checks aligned with cell columns', () => {
    const lines = cellAlignedLines(buffer([[EMOJI, '', SLOT]]))
    expect(isIipSlotPresent(lines, { slotRow: 0, slotCol: 2, slot: SLOT })).toBe(true)
    expect(isIipSlotPresent(lines, { slotRow: 0, slotCol: 3, slot: SLOT })).toBe(false)
  })

  it('leaves wide-glyph continuation cells blank so blank runs stay detectable', () => {
    const lines = cellAlignedLines(
      buffer([
        [' ', EMOJI, '', ' '],
        [' ', ' ', ' ', ' ']
      ])
    )
    expect(lines[0].trim()).not.toBe('')
    expect(lines[1].trim()).toBe('')
  })

  it('maps rows the buffer cannot produce to empty strings', () => {
    const lines = cellAlignedLines({
      length: 3,
      getLine: (index: number) => (index === 1 ? undefined : row(['a']))
    })
    expect(lines).toEqual(['a', '', 'a'])
  })
})
