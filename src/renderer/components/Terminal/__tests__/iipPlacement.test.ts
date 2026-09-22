import { describe, it, expect } from 'vitest'
import {
  buildIipImage,
  createIipStreamExtractor,
  findIipSlot,
  fitIipToCells,
  type IipImage,
} from '../iipParser'

const ESC = '\x1b'
const PNG_B64 = 'iVBORw0KGgo'

function makeImage(fields: string, payload = PNG_B64): IipImage {
  return buildIipImage(fields, payload)
}

describe('IIP slot markers', () => {
  it('replaces each IIP with a unique 1-char slot in the stream', () => {
    const extract = createIipStreamExtractor()
    const a = `${ESC}]1337;File=inline=1;width=2:${PNG_B64}\x07`
    const b = `${ESC}]1337;File=inline=1;width=3:${PNG_B64}\x07`
    const { out, images } = extract(`X${a}Y${b}Z`)
    expect(images).toHaveLength(2)
    expect(images[0].slot).not.toBe(images[1].slot)
    expect(images[0].slot).toHaveLength(1)

    expect(out).toBe(`X${images[0].slot}Y${images[1].slot}Z`)
  })

  it('findIipSlot locates row/col of a slot in buffer lines', () => {
    const slot = ''
    const lines = ['hello', `ab${slot}cd`, 'end']
    expect(findIipSlot(lines, slot)).toEqual({ row: 1, col: 2 })
  })

  it('findIipSlot returns null when absent', () => {
    expect(findIipSlot(['a', 'b'], '')).toBeNull()
  })
})

describe('fitIipToCells for omp width=51 height=auto (1254×1033 webp)', () => {
  it('uses 51 columns and derives rows from aspect + cell metrics', () => {
    const img = makeImage('inline=1;width=51;height=auto')
    const cell = { widthPx: 9, heightPx: 18 }
    const fit = fitIipToCells(img, { widthPx: 1254, heightPx: 1033 }, cell, 120)
    expect(fit.cols).toBe(51)

    expect(fit.rows).toBe(21)
  })
})

describe('top-left anchor from slot position', () => {
  it('slot row/col IS the image top-left (not the bottom)', () => {

    const extract = createIipStreamExtractor()
    const frame = `${ESC}]1337;File=inline=1;width=51;height=auto:${PNG_B64}\x07`

    const stream = `${ESC}7${ESC}[20A${frame}${ESC}8`
    const { out, images } = extract(stream)
    expect(images).toHaveLength(1)
    const slot = images[0].slot

    expect(out).toBe(`${ESC}7${ESC}[20A${slot}${ESC}8`)
    const lines = [`${'x'.repeat(10)}${' '.repeat(100)}`, 'painted line', `col16${slot}`]

    const hit = findIipSlot(lines, slot)
    expect(hit).toEqual({ row: 2, col: 5 })
  })
})
