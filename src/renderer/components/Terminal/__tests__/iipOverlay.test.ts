import { describe, it, expect } from 'vitest'
import { fitIipToCells } from '../IipOverlay'
import { buildIipImage } from '../iipParser'

const PNG_B64 = 'iVBORw0KGgo'
const cell = { widthPx: 10, heightPx: 20 }

describe('fitIipToCells', () => {
  it('uses explicit cell width and auto height from intrinsic aspect', () => {
    const img = buildIipImage('inline=1;width=20;height=auto', PNG_B64)
    const fit = fitIipToCells(img, { widthPx: 400, heightPx: 200 }, cell, 80)
    expect(fit.cols).toBe(20)
    // 20 cols * 10px = 200px wide; 2:1 image → 100px tall → 5 rows
    expect(fit.rows).toBe(5)
  })

  it('honors px width and cell height', () => {
    const img = buildIipImage('width=100px;height=3', PNG_B64)
    const fit = fitIipToCells(img, { widthPx: 800, heightPx: 600 }, cell, 80)
    expect(fit.cols).toBe(10)
    expect(fit.rows).toBe(3)
  })

  it('falls back to intrinsic size when both auto', () => {
    const img = buildIipImage('width=auto;height=auto', PNG_B64)
    const fit = fitIipToCells(img, { widthPx: 200, heightPx: 100 }, cell, 80)
    expect(fit.cols).toBe(20)
    expect(fit.rows).toBe(5)
  })
})
