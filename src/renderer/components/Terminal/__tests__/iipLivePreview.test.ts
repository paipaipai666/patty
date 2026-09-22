import { describe, it, expect } from 'vitest'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIipStreamExtractor, findIipSlot, fitIipToCells, buildIipImage } from '../iipParser'
import { resolveAnchor, commitIipPlacement, type IipOverlayItem } from '../iipAnchor'

const ESC = '\x1b'
const ROOT = resolve(__dirname, '../../../../..')
const PNG_PATH = resolve(ROOT, 'tmp-test-image.png')

                                                                      
function encodeITerm2(base64Data: string, width: number): string {
  return `${ESC}]1337;File=inline=1;width=${width};height=auto:${base64Data}\x07`
}

describe('live preview against omp encodeITerm2 wire format', () => {
  it('maps the real CUF-repaint slot (block bottom) to a top-left overlay', () => {
    const png = readFileSync(PNG_PATH)
    const b64 = png.toString('base64')
    const width = 20
    const blockRows = 10
    const iip = encodeITerm2(b64, width)


    const frame = `\r${ESC}[K${ESC}[106C${iip}`
    const extract = createIipStreamExtractor()
    const r1 = extract(frame)
    expect(r1.images).toHaveLength(1)

    const slot = r1.images[0].slot

    const bottom = blockRows - 1
    const lines: string[] = Array.from({ length: blockRows }, () => '')
    lines[bottom] = ' '.repeat(106) + slot
    const hit = findIipSlot(lines, slot)
    expect(hit).toEqual({ row: bottom, col: 106 })

    const img = buildIipImage(`inline=1;width=${width};height=auto`, b64, slot)
    const cell = { widthPx: 9, heightPx: 18 }
    const fit = fitIipToCells(img, { widthPx: 320, heightPx: 200 }, cell, 120)
    expect(fit.cols).toBe(width)

    const a = resolveAnchor(hit, lines, bottom, fit.rows)

    expect(a.topY).toBe(bottom - fit.rows + 1)
    expect(a.fromSlot).toBe(true)


    const r2 = extract(frame)
    expect(r2.images).toHaveLength(1)
    const hit2 = { row: 15, col: 106 }
    const firstItem: IipOverlayItem = {
      id: 1,
      key: 'k',
      dataUrl: r1.images[0].dataUrl,
      bufferY: a.topY,
      col: a.col,
      rows: fit.rows,
      cols: fit.cols,
      fromSlot: true,
      slot,
      slotRow: hit.row,
      slotCol: hit.col,
    }
    const lines2: string[] = Array.from({ length: 30 }, () => '')
    lines2[hit.row] = ' '.repeat(106) + slot
    lines2[hit2.row] = ' '.repeat(106) + r2.images[0].slot
    const committed = commitIipPlacement(
      [firstItem],
      {
        ...firstItem,
        id: 0,
        bufferY: hit2.row - fit.rows + 1,
        slot: r2.images[0].slot,
        slotRow: hit2.row,
        slotCol: hit2.col,
      },
      lines2
    )
    expect(committed).toHaveLength(2)
    expect(committed[0].bufferY).toBe(a.topY)
    expect(committed[1].bufferY).toBe(hit2.row - fit.rows + 1)

    const top = a.topY
    const left = a.col
    const html = `<!doctype html><meta charset="utf-8"><title>IIP overlay preview</title>
<body style="margin:0;background:#1e1e1e;font:12px monospace;color:#ccc">
  <div style="position:relative;width:720px;height:360px;background:#0c0c0c;overflow:hidden">
    ${Array.from({ length: 20 }, (_, i) =>
      `<div style="position:absolute;left:8px;top:${i * 18}px;height:18px;line-height:18px">${
        i === top ? 'TOP of image' : i === bottom ? 'SLOT (IIP line / block bottom)' : i > top && i < bottom ? '· reserved ·' : ''
      }</div>`
    ).join('')}
    <img src="data:image/png;base64,${b64}"
         style="position:absolute;z-index:30;left:${left * cell.widthPx}px;top:${Math.max(0, top) * cell.heightPx}px;width:${fit.cols * cell.widthPx}px;height:${fit.rows * cell.heightPx}px;object-fit:contain;outline:1px solid #0f0"/>
  </div>
  <p>top=${top} left=${left} slotRow=${bottom} fit=${fit.cols}x${fit.rows}</p>
</body>`
    const outDir = resolve(ROOT, 'output/playwright')
    mkdirSync(outDir, { recursive: true })
    writeFileSync(resolve(outDir, 'iip-live-preview.html'), html)
    // eslint-disable-next-line no-console
    console.log('[preview]', { a, committed: committed.length, fit, hit })
  })
})
