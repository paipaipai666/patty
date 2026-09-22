import type { IipImage } from './iipParser'

                                                                    
export interface IipOverlayItem {
  id: number
                                                                        
  row: number
                                                   
  col: number
  rows: number
  cols: number
  dataUrl: string
  name?: string
  preserveAspectRatio?: number
}

export interface CellSize {
  widthPx: number
  heightPx: number
}

export interface IipOverlayProps {
  items: IipOverlayItem[]
  cell: CellSize
                                                                       
  originX: number
  originY: number
  onDismiss?: (id: number) => void
}


   
export function IipOverlay({ items, cell, originX, originY }: IipOverlayProps) {
  if (items.length === 0) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',

        zIndex: 30,
      }}
    >
      {items.map((item) => {
        const w = Math.max(1, item.cols) * cell.widthPx
        const h = Math.max(1, item.rows) * cell.heightPx
        return (
          <img
            key={item.id}
            src={item.dataUrl}
            alt={item.name ?? 'inline image'}
            draggable={false}
            style={{
              position: 'absolute',
              left: originX + item.col * cell.widthPx,
              top: originY + item.row * cell.heightPx,
              width: w,
              height: h,
              objectFit: item.preserveAspectRatio === 0 ? 'fill' : 'contain',
              imageRendering: 'auto',
            }}
          />
        )
      })}
    </div>
  )
}


   
export function fitIipToCells(
  image: IipImage,
  intrinsic: { widthPx: number; heightPx: number },
  cell: CellSize,
  maxWidthCols: number,
): { cols: number; rows: number } {
  const parseDim = (v: string | undefined, max: number, axisPx: number): number | null => {
    if (!v || v === 'auto') return null
    if (v.endsWith('px')) {
      const n = Number.parseFloat(v)
      return Number.isFinite(n) ? Math.max(1, Math.ceil(n / axisPx)) : null
    }
    if (v.endsWith('%')) {
      const n = Number.parseFloat(v)
      return Number.isFinite(n) ? Math.max(1, Math.ceil((n / 100) * max)) : null
    }
    if (/^\d+$/.test(v)) return Math.max(1, Number.parseInt(v, 10))
    return null
  }

  const maxCols = Math.max(1, maxWidthCols)
  const maxRows = 200
  let cols = parseDim(image.header.width, maxCols, cell.widthPx)
  let rows = parseDim(image.header.height, maxRows, cell.heightPx)

  const natCols = Math.max(1, Math.ceil(intrinsic.widthPx / cell.widthPx))
  const natRows = Math.max(1, Math.ceil(intrinsic.heightPx / cell.heightPx))

  if (cols == null && rows == null) {
    cols = Math.min(natCols, maxCols)
    rows = Math.max(1, Math.round((intrinsic.heightPx / intrinsic.widthPx) * cols * (cell.widthPx / cell.heightPx)))
  } else if (cols == null && rows != null) {
    cols = Math.max(1, Math.round((intrinsic.widthPx / intrinsic.heightPx) * rows * (cell.heightPx / cell.widthPx)))
  } else if (cols != null && rows == null) {
    rows = Math.max(1, Math.round((intrinsic.heightPx / intrinsic.widthPx) * cols * (cell.widthPx / cell.heightPx)))
  }

  cols = Math.min(cols ?? 1, maxCols)
  rows = Math.min(rows ?? 1, maxRows)
  return { cols, rows }
}
