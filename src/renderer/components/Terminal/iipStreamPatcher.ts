/**
 * IIP (iTerm2 inline image, OSC 1337) stream patcher.
 *
 * Used by TerminalPane to make @xterm/addon-image render chafa's IIP output.
 * Kept in its own module so the logic is unit-testable without importing React.
 *
 * Two fixes applied to the stream:
 *
 * 1. Header `size` injection.
 *    @xterm/addon-image's IIPHandler aborts on a missing *or zero* `size`
 *    field (IIPHandler.ts:69 `!this._header.size`). chafa omits `size`
 *    entirely (legal per the iTerm2 spec — it only drives the progress
 *    indicator), so its images are silently dropped. We inject the real
 *    decoded payload length, which passes both the abort check and the
 *    `iipSizeLimit` gate, and preallocates the decoder buffer exactly.
 *    (An earlier version injected `size=0`; that still fails the `!size`
 *    check and never rendered.)
 *
 * 2. TIFF → PNG payload transcode.
 *    chafa always wraps IIP pixels in an *uncompressed* TIFF container
 *    (chafa-iterm2-canvas.c: "We support iTerm2 images by embedding them as
 *    uncompressed TIFF files"), while addon-image only sniffs PNG/JPEG/GIF
 *    (IIPMetrics.ts) and drops TIFF. The TIFF chafa writes has a fixed minimal
 *    layout (little-endian, RGBA8, one strip, no compression), so we decode it
 *    and re-emit the same pixels as PNG. The PNG uses stored (uncompressed)
 *    deflate blocks, so the encoder is tiny and fully synchronous — which
 *    keeps `term.write` ordering intact. Wire size is unchanged (both are
 *    uncompressed). Non-TIFF payloads (e.g. yazi's PNG) pass through
 *    untouched; if such a payload also lacks `size` we inject `size=0`, which
 *    preserves the addon's previous behavior (it aborts the image) without
 *    affecting the surrounding stream.
 *
 * Bounded state machine — never a naive cross-chunk string replace:
 * - Non-IIP data passes through with zero buffering and zero latency.
 * - Only buffers while scanning for the `\x1b]1337;File=` prefix, while a TIFF
 *   payload is in flight, or while sniffing the first 4 base64 chars that
 *   distinguish TIFF from passable formats. Buffering is capped
 *   (IIP_HEADER_SCAN_LIMIT / TIFF_B64_LIMIT) so a malformed stream can never
 *   accumulate unbounded memory.
 */

const IIP_HEADER_SCAN_LIMIT = 1024

// chafa's TIFF is always little-endian; its first four bytes ("II*\0") encode
// to this base64 prefix. Anything else (PNG `iVBOR...`, JPEG `/9j/...`, GIF
// `R0lG...`) is already renderable by addon-image.
const TIFF_B64_PREFIX = 'SUkq'

// Give up on a TIFF payload past this many base64 chars (~22 MB decoded, above
// addon-image's default 20 MB iipSizeLimit): emit it raw — the addon drops it,
// which is exactly the unpatched behavior — instead of buffering forever.
const TIFF_B64_LIMIT = 30_000_000

// iTerm2 payloads end with BEL or ST (ESC \). base64 never contains either.
function firstTerminator(s: string, from: number): number {
  const bel = s.indexOf('\x07', from)
  const st = s.indexOf('\x1b\\', from)
  if (bel === -1) return st
  if (st === -1) return bel
  return Math.min(bel, st)
}

/**
 * Returns a stream-patcher closure. Call it once per terminal instance and run
 * every PTY → xterm data chunk through the returned function.
 */
export function createIIPStreamPatcher(): (data: string) => string {
  // `buf` holds unresolved bytes starting at a `\x1b`: a partial `\x1b]1337`
  // marker split across chunks, an IIP header whose terminating `:` has not
  // arrived, or a whole in-flight TIFF payload. Empty most of the time:
  // non-IIP chunks never enter this path, and base64 payloads never contain
  // the `\x1b]1337` marker (base64 alphabet excludes ESC).
  let buf = ''
  const marker = '\x1b]1337'

  // Inject `size=<size>;` right after `File=` when the header has no size
  // field; otherwise return the header unchanged.
  const patchHeader = (header: string, size: number): string => {
    if (/(^|;)size=/.test(header)) {
      return marker + header
    }
    const injectAt = header.indexOf('File=') + 'File='.length
    return marker + header.slice(0, injectAt) + `size=${size};` + header.slice(injectAt)
  }

  return (data: string): string => {
    if (buf === '' && data.indexOf(marker) === -1 && partialMarkerSuffixLen(data) === 0) {
      // Fast path: no IIP marker, and the chunk doesn't end with a partial
      // marker prefix (a trailing `\x1b`, `\x1b]`, `\x1b]1`, ... that could
      // continue as `\x1b]1337` in the next chunk). Zero-cost passthrough.
      return data
    }

    const combined = buf + data
    let out = ''
    let pos = 0 // scan cursor within `combined`

    while (pos < combined.length) {
      const markerPos = combined.indexOf(marker, pos)
      if (markerPos === -1) {
        // No more markers. Emit the remaining tail, but hold back a possible
        // partial marker prefix at the very end (a trailing `\x1b`, `\x1b]`,
        // ... that could continue as `\x1b]1337` in the next chunk).
        const tail = combined.slice(pos)
        const hold = partialMarkerSuffixLen(tail)
        if (hold > 0 && hold < tail.length) {
          out += tail.slice(0, tail.length - hold)
          buf = tail.slice(tail.length - hold)
        } else if (hold === tail.length) {
          // The whole remaining tail is a possible marker prefix; hold it all.
          buf = tail
        } else {
          out += tail
          buf = ''
        }
        break
      }

      // Emit text before the marker unchanged.
      out += combined.slice(pos, markerPos)

      // We are at a marker. Find the `:` ending the header.
      const colon = combined.indexOf(':', markerPos)
      if (colon === -1) {
        // Header not terminated in this chunk. Hold from the marker onward,
        // capped to avoid unbounded growth on malformed streams.
        const held = combined.slice(markerPos)
        if (held.length > IIP_HEADER_SCAN_LIMIT) {
          out += held // give up: emit raw, stop trying to patch this one
          buf = ''
        } else {
          buf = held
        }
        break
      }

      const header = combined.slice(markerPos + marker.length, colon)
      const payloadStart = colon + 1

      // Sniff the first payload bytes: only TIFF needs transcode. Fewer than 4
      // base64 chars available and no terminator yet → hold from the marker
      // until the sniff can be decided (bounded: 4 chars).
      if (combined.length - payloadStart < 4 && firstTerminator(combined, payloadStart) === -1) {
        buf = combined.slice(markerPos)
        break
      }

      if (combined.startsWith(TIFF_B64_PREFIX, payloadStart)) {
        // TIFF payload: buffer until the terminator, then transcode to PNG.
        const termIdx = firstTerminator(combined, payloadStart)
        if (termIdx === -1) {
          const held = combined.slice(markerPos)
          if (held.length > TIFF_B64_LIMIT) {
            // Oversize: emit the patched header + raw TIFF payload. The addon
            // enforces its own size limit and drops the image — the stream
            // itself stays valid.
            out += patchHeader(header, 0) + ':' + combined.slice(payloadStart)
            buf = ''
          } else {
            buf = held
          }
          break
        }
        const termLen = combined[termIdx] === '\x07' ? 1 : 2
        const terminator = combined.slice(termIdx, termIdx + termLen)
        const payloadB64 = combined.slice(payloadStart, termIdx)
        let payload = payloadB64
        let size = 0
        const tiff = decodeBase64(payloadB64)
        if (tiff !== null) {
          size = tiff.length // raw TIFF fallback: valid size for the addon's gates
          const png = transcodeTiffBytes(tiff)
          if (png !== null) {
            payload = png.b64
            size = png.len
          }
        }
        out += patchHeader(header, size) + ':' + payload + terminator
        // The image segment is fully consumed — drop the held buffer. Without
        // this, when the terminator was the last byte of the chunk, the loop
        // exits with `buf` still holding the entire image; the next chunk
        // re-processes it and a later OSC's ST becomes a phantom terminator,
        // re-emitting a corrupt second copy.
        buf = ''
        pos = termIdx + termLen
        continue
      }

      // Passable payload (PNG/JPEG/GIF): emit the patched header, then the
      // payload verbatim. It cannot contain another `\x1b]1337` (base64
      // alphabet excludes ESC), so scan for the next marker and emit the gap,
      // then loop to patch it too.
      out += patchHeader(header, 0) + ':'
      const nextMarker = combined.indexOf(marker, payloadStart)
      if (nextMarker === -1) {
        // No further marker; but hold back a possible partial-marker suffix.
        const tail = combined.slice(payloadStart)
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
      out += combined.slice(payloadStart, nextMarker)
      pos = nextMarker
    }

    return out
  }
}

/**
 * If `tail` ends with a prefix of the IIP marker `\x1b]1337` (e.g. a trailing
 * `\x1b`, `\x1b]`, `\x1b]1`, ...), return the length of that partial prefix so
 * the caller can hold it for the next chunk. Returns 0 if the tail does not
 * end with a marker prefix.
 *
 * Example: tail ending in `...\x1b]1` returns 3 (the `\x1b]1` could become
 * `\x1b]1337`). A tail ending in `...x\x1b` returns 1.
 */
function partialMarkerSuffixLen(tail: string): number {
  const marker = '\x1b]1337'
  // Check the longest possible partial first so we return the maximal hold.
  for (let len = Math.min(marker.length - 1, tail.length); len >= 1; len--) {
    if (marker.startsWith(tail.slice(tail.length - len))) {
      return len
    }
  }
  return 0
}

/* ------------------------- TIFF → PNG transcode ------------------------- */

function decodeBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[])
  }
  return btoa(bin)
}

/**
 * Transcode chafa's uncompressed-RGBA TIFF to PNG base64, also reporting the
 * PNG byte length for the IIP `size` field. Returns null when the input is not
 * a supported TIFF; the caller then re-emits the original payload unchanged.
 */
function transcodeTiffBytes(tiff: Uint8Array): { b64: string; len: number } | null {
  const img = parseUncompressedRgbaTiff(tiff)
  if (img === null) return null
  const png = encodePngRgba(img.width, img.height, img.rgba)
  return { b64: encodeBase64(png), len: png.length }
}

/**
 * Parse the fixed-layout TIFF chafa writes for IIP: little-endian, RGBA8,
 * single strip, no compression. Returns null on any deviation — this parser is
 * deliberately not a general TIFF reader.
 */
function parseUncompressedRgbaTiff(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null {
  if (bytes.length < 8) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) !== 0x002a4949) return null // "II*\0" little-endian magic
  const ifd = dv.getUint32(4, true)
  if (ifd + 2 > bytes.length) return null
  const count = dv.getUint16(ifd, true)
  if (ifd + 2 + count * 12 > bytes.length) return null

  let width = 0
  let height = 0
  let stripOffset = -1
  let stripBytes = -1
  let compression = 1
  let photometric = 2
  let samples = 4
  let planar = 1
  for (let i = 0; i < count; i++) {
    const off = ifd + 2 + i * 12
    const tag = dv.getUint16(off, true)
    const type = dv.getUint16(off + 2, true)
    const val = dv.getUint32(off + 8, true)
    // SHORT values (count=1) sit in the low 2 bytes of the 4-byte value field.
    const v = type === 3 ? val & 0xffff : val
    switch (tag) {
      case 256: width = v; break
      case 257: height = v; break
      case 259: compression = v; break
      case 262: photometric = v; break
      case 273: stripOffset = val; break
      case 277: samples = v; break
      case 279: stripBytes = val; break
      case 284: planar = v; break
    }
  }
  if (compression !== 1 || photometric !== 2 || samples !== 4 || planar !== 1) return null
  // addon-image's default pixelLimit is 4096²; transcoding more is pointless.
  if (width <= 0 || height <= 0 || width * height > 16_777_216) return null
  const need = width * height * 4
  if (stripOffset < 8 || stripOffset + need > bytes.length) return null
  if (stripBytes !== -1 && stripBytes < need) return null
  return { width, height, rgba: bytes.subarray(stripOffset, stripOffset + need) }
}

/* ------------------------------ PNG encode ------------------------------ */

let crcTable: Uint32Array | null = null

function crc32(bytes: Uint8Array): number {
  if (crcTable === null) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = (crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0
  }
  return (crc ^ 0xffffffff) >>> 0
}

function adler32(bytes: Uint8Array): number {
  let s1 = 1
  let s2 = 0
  // Defer the modulo: 5552 is the largest run where 32-bit sums can't overflow.
  const NMAX = 5552
  for (let i = 0; i < bytes.length; i += NMAX) {
    const end = Math.min(i + NMAX, bytes.length)
    for (let j = i; j < end; j++) {
      s1 += bytes[j]
      s2 += s1
    }
    s1 %= 65521
    s2 %= 65521
  }
  return ((s2 << 16) | s1) >>> 0
}

/**
 * Encode RGBA8 pixels as a minimal PNG: truecolor+alpha, no interlace, zlib
 * stream made of stored (uncompressed) deflate blocks. Stored blocks keep the
 * encoder synchronous and branch-free; the source TIFF is equally
 * uncompressed, so nothing is lost on the wire.
 */
function encodePngRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const rowBytes = width * 4
  const rawLen = height * (1 + rowBytes) // 1 filter byte per scanline
  const raw = new Uint8Array(rawLen)
  for (let y = 0; y < height; y++) {
    const dst = y * (1 + rowBytes)
    raw[dst] = 0 // filter: none
    raw.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), dst + 1)
  }

  const nBlocks = Math.ceil(rawLen / 65535)
  const idatLen = 2 + nBlocks * 5 + rawLen + 4 // zlib header + block headers + data + adler32
  const png = new Uint8Array(57 + idatLen)
  const dv = new DataView(png.buffer)

  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0) // signature

  // IHDR
  dv.setUint32(8, 13)
  png.set([0x49, 0x48, 0x44, 0x52], 12) // "IHDR"
  dv.setUint32(16, width)
  dv.setUint32(20, height)
  png[24] = 8 // bit depth
  png[25] = 6 // color type RGBA
  // [26..28] compression / filter / interlace = 0
  dv.setUint32(29, crc32(png.subarray(12, 29)))

  // IDAT
  dv.setUint32(33, idatLen)
  png.set([0x49, 0x44, 0x41, 0x54], 37) // "IDAT"
  let p = 41
  png[p++] = 0x78 // zlib CMF: deflate, 32K window
  png[p++] = 0x01 // zlib FLG: check bits, no dict, fastest
  let off = 0
  for (let b = 0; b < nBlocks; b++) {
    const len = Math.min(65535, rawLen - off)
    png[p++] = b === nBlocks - 1 ? 1 : 0 // BFINAL on last block, BTYPE=stored
    png[p++] = len & 0xff
    png[p++] = (len >> 8) & 0xff
    const nlen = ~len & 0xffff
    png[p++] = nlen & 0xff
    png[p++] = (nlen >> 8) & 0xff
    png.set(raw.subarray(off, off + len), p)
    p += len
    off += len
  }
  dv.setUint32(p, adler32(raw))
  dv.setUint32(41 + idatLen, crc32(png.subarray(37, 41 + idatLen)))

  // IEND
  dv.setUint32(45 + idatLen, 0)
  png.set([0x49, 0x45, 0x4e, 0x44], 49 + idatLen) // "IEND"
  dv.setUint32(53 + idatLen, crc32(png.subarray(49 + idatLen, 53 + idatLen)))

  return png
}
