import { describe, it, expect } from 'vitest'
import { IipOverlay } from '../IipOverlay'
import { buildIipImage } from '../iipParser'


   
describe('IipOverlay stacking', () => {
  it('root layer sits above xterm canvases (z-index >= 20)', () => {
    const image = buildIipImage('inline=1;width=10;height=2', 'iVBORw0KGgo')
    const el = IipOverlay({
      items: [{ id: 1, dataUrl: image.dataUrl, row: 0, col: 0, rows: 2, cols: 10 }],
      cell: { widthPx: 9, heightPx: 18 },
      originX: 0,
      originY: 0,
    })
    expect(el).not.toBeNull()
    const style = (el as { props: { style: Record<string, number> } }).props.style
    expect(style.zIndex).toBeGreaterThanOrEqual(20)

    expect(style.pointerEvents).toBe('none')
  })
})
