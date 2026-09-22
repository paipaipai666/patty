
   

export interface IipHeader {
                                                                          
  inline: number
                                                            
  size?: number
                                            
  width?: string
  height?: string
  name?: string
  preserveAspectRatio?: number
}

export interface IipImage {
  header: IipHeader
                                            
  payloadBase64: string
                                                                                
  mimeType: string | null
                                                      
  dataUrl: string
                                                                       
  isInline: boolean

     
  slot: string
}

export interface IipExtractResult {
                                                                        
  out: string
                                                        
  images: IipImage[]
}

const MARKER = '\x1b]1337'
const HEADER_SCAN_LIMIT = 1024

function firstTerminator(s: string, from: number): number {
  const bel = s.indexOf('\x07', from)
  const st = s.indexOf('\x1b\\', from)
  if (bel === -1) return st
  if (st === -1) return bel
  return Math.min(bel, st)
}

function partialMarkerSuffixLen(tail: string): number {
  for (let len = Math.min(MARKER.length - 1, tail.length); len >= 1; len--) {
    if (MARKER.startsWith(tail.slice(tail.length - len))) return len
  }
  return 0
}

                                                                    
export function parseIipFileHeader(fields: string): IipHeader {
  const header: IipHeader = { inline: 0 }

  for (const part of fields.split(';')) {
    if (!part) continue
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    const value = part.slice(eq + 1)
    switch (key) {
      case 'inline':
        header.inline = toIntLoose(value) ?? 0
        break
      case 'size':
        header.size = toIntLoose(value)
        break
      case 'width':
        header.width = value
        break
      case 'height':
        header.height = value
        break
      case 'name':
        header.name = value
        break
      case 'preserveaspectratio':
        header.preserveAspectRatio = toIntLoose(value)
        break
    }
  }
  return header
}

function toIntLoose(v: string): number | undefined {
  if (!/^\d+$/.test(v)) return undefined
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : undefined
}


   
export function sniffMimeFromBase64(b64: string): string | null {
  if (b64.startsWith('iVBOR')) return 'image/png'
  if (b64.startsWith('/9j/')) return 'image/jpeg'
  if (b64.startsWith('R0lG')) return 'image/gif'
  if (b64.startsWith('UklGR')) return 'image/webp'
  return null
}

function decodeNameBase64(b64: string): string {
  try {
    return atob(b64)
  } catch {
    return b64
  }
}


   
export function buildIipImage(fields: string, payloadBase64: string, slot: string = ''): IipImage {
  const header = parseIipFileHeader(fields)
  if (header.name) header.name = decodeNameBase64(header.name)
  const mimeType = sniffMimeFromBase64(payloadBase64)
  const dataUrl = mimeType
    ? `data:${mimeType};base64,${payloadBase64}`
    : `data:application/octet-stream;base64,${payloadBase64}`
  return {
    header,
    payloadBase64,
    mimeType,
    dataUrl,
    isInline: header.inline === 1,
    slot,
  }
}

                                              
export const IIP_SLOT0 = 0xe000

                                                          
export function nextIipSlot(n: number): string {
  return String.fromCharCode(IIP_SLOT0 + (n % 0xf8ff))
}


   
export function findIipSlot(
  lines: readonly string[],
  slot: string
): { row: number; col: number } | null {
  for (let row = 0; row < lines.length; row++) {
    const col = lines[row].indexOf(slot)
    if (col !== -1) return { row, col }
  }
  return null
}


   
export function fitIipToCells(
  image: IipImage,
  intrinsic: { widthPx: number; heightPx: number },
  cell: { widthPx: number; heightPx: number },
  maxWidthCols: number
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

  if (cols == null && rows == null) {
    cols = Math.min(Math.max(1, Math.ceil(intrinsic.widthPx / cell.widthPx)), maxCols)
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


   
export function createIipStreamExtractor(): (data: string) => IipExtractResult {
  let buf = ''
  let slotCount = 0

  return (data: string): IipExtractResult => {
    const images: IipImage[] = []
    if (buf === '' && data.indexOf(MARKER) === -1 && partialMarkerSuffixLen(data) === 0) {
      return { out: data, images }
    }

    const combined = buf + data
    let out = ''
    let pos = 0

    while (pos < combined.length) {
      const markerPos = combined.indexOf(MARKER, pos)
      if (markerPos === -1) {
        const tail = combined.slice(pos)
        const hold = partialMarkerSuffixLen(tail)
        if (hold > 0 && hold < tail.length) {
          out += tail.slice(0, tail.length - hold)
          buf = tail.slice(tail.length - hold)
        } else if (hold === tail.length) {
          buf = tail
        } else {
          out += tail
          buf = ''
        }
        break
      }

      out += combined.slice(pos, markerPos)


      const fileAt = combined.indexOf('File=', markerPos)
      const colon = combined.indexOf(':', markerPos)
      if (fileAt === -1 || colon === -1 || colon < fileAt) {
        const held = combined.slice(markerPos)
        if (held.length > HEADER_SCAN_LIMIT) {
          out += held
          buf = ''
        } else {
          buf = held
        }
        break
      }

      const fields = combined.slice(fileAt + 'File='.length, colon)
      const payloadStart = colon + 1


      const termIdx = firstTerminator(combined, payloadStart)
      const nextMarker = combined.indexOf(MARKER, payloadStart)
      let endIdx = -1
      let termLen = 0
      if (termIdx !== -1 && (nextMarker === -1 || termIdx < nextMarker)) {
        endIdx = termIdx
        termLen = combined[termIdx] === '\x07' ? 1 : 2
      } else if (nextMarker !== -1) {
        endIdx = nextMarker
      }

      if (endIdx === -1) {
        const held = combined.slice(markerPos)
        if (held.length > 30_000_000) {
          out += held
          buf = ''
        } else {
          buf = held
        }
        break
      }

      const payloadB64 = combined.slice(payloadStart, endIdx)
      const slot = nextIipSlot(slotCount++)
      images.push(buildIipImage(fields, payloadB64, slot))
      out += slot
      buf = ''
      pos = endIdx + termLen
    }

    return { out, images }
  }
}
