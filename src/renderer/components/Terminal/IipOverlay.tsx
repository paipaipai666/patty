import type { CellSize } from './iipParser'

                                                                    
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


   
