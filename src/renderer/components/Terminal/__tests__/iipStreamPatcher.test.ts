import { describe, it, expect } from 'vitest'
import { createIIPStreamPatcher } from '../iipStreamPatcher'

const ESC = '\x1b'

describe('createIIPStreamPatcher', () => {
  it('passes through non-IIP data unchanged', () => {
    const patcher = createIIPStreamPatcher()
    expect(patcher('hello world')).toBe('hello world')
    expect(patcher('normal text with no escape')).toBe('normal text with no escape')
    expect(patcher('')).toBe('')
  })

  it('passes through escape codes that are not IIP markers', () => {
    const patcher = createIIPStreamPatcher()
    expect(patcher(`${ESC}[31mred`)).toBe(`${ESC}[31mred`)
  })

  it('injects size=0 into an IIP header missing size', () => {
    const patcher = createIIPStreamPatcher()
    const input = `${ESC}]1337;File=name=test.png;:base64data${ESC}\\`
    const output = patcher(input)
    expect(output).toBe(`${ESC}]1337;File=size=0;name=test.png;:base64data${ESC}\\`)
  })

  it('does not inject size when already present', () => {
    const patcher = createIIPStreamPatcher()
    const input = `${ESC}]1337;File=name=test.png;size=100;:base64data${ESC}\\`
    expect(patcher(input)).toBe(input)
  })

  it('injects size=0 after File= when other fields precede it', () => {
    const patcher = createIIPStreamPatcher()
    const input = `${ESC}]1337;File=name=a.png;width=100;:data`
    const output = patcher(input)
    expect(output).toBe(`${ESC}]1337;File=size=0;name=a.png;width=100;:data`)
  })

  it('handles partial marker prefix at the end of a chunk (hold for next)', () => {
    const patcher = createIIPStreamPatcher()
    const chunk1 = `${ESC}]`
    const chunk2 = `1337;File=name=test.png;:data`

    const out1 = patcher(chunk1)
    // First chunk holds the partial marker
    expect(out1).toBe('')
    const out2 = patcher(chunk2)
    expect(out2).toBe(`${ESC}]1337;File=size=0;name=test.png;:data`)
  })

  it('handles marker split across multiple chunks character by character', () => {
    const patcher = createIIPStreamPatcher()
    const chunks = [`${ESC}`, ']', '1', '3', '3', '7;File=name=x.png;:data']

    for (let i = 0; i < chunks.length - 1; i++) {
      expect(patcher(chunks[i])).toBe('')
    }
    const last = patcher(chunks[chunks.length - 1])
    expect(last).toBe(`${ESC}]1337;File=size=0;name=x.png;:data`)
  })

  it('handles header colon split across chunks', () => {
    const patcher = createIIPStreamPatcher()
    const chunk1 = `${ESC}]1337;File=name=test.png;`
    const chunk2 = `:base64data`

    expect(patcher(chunk1)).toBe('')
    const out2 = patcher(chunk2)
    expect(out2).toBe(`${ESC}]1337;File=size=0;name=test.png;:base64data`)
  })

  it('handles the partial marker `\\x1b` at end of chunk', () => {
    const patcher = createIIPStreamPatcher()
    expect(patcher('hello\x1b')).toBe('hello') // emits text, holds \x1b
    expect(patcher(']1337;File=name=t.png;:data')).toBe(
      '\x1b]1337;File=size=0;name=t.png;:data'
    )
  })

  it('handles varying partial marker suffixes', () => {
    const patcher = createIIPStreamPatcher()
    expect(patcher(`${ESC}]1`)).toBe('') // holds \x1b]1
    expect(patcher(`337;File=name=t.png;:data`)).toBe(
      `${ESC}]1337;File=size=0;name=t.png;:data`
    )
  })

  it('processes multiple IIP markers in one chunk', () => {
    const patcher = createIIPStreamPatcher()
    const input =
      `${ESC}]1337;File=name=a.png;:data1` +
      `${ESC}]1337;File=name=b.png;:data2`
    const output = patcher(input)
    expect(output).toBe(
      `${ESC}]1337;File=size=0;name=a.png;:data1` +
      `${ESC}]1337;File=size=0;name=b.png;:data2`
    )
  })

  it('processes mixed content: non-IIP, IIP, non-IIP', () => {
    const patcher = createIIPStreamPatcher()
    const input = `prefix${ESC}]1337;File=name=x.png;:datasuffix`
    const output = patcher(input)
    expect(output).toBe(`prefix${ESC}]1337;File=size=0;name=x.png;:datasuffix`)
  })

  it('recovers after a malformed unbounded header by emitting raw at 1024 limit', () => {
    const patcher = createIIPStreamPatcher()
    const longGarbage = `${ESC}]1337;` + 'A'.repeat(2000)
    const output = patcher(longGarbage)
    // Once the held data exceeds 1024 bytes, it should emit the raw data
    expect(output).toBe(longGarbage)
  })

  it('preserves partial marker suffix after payload when next marker starts later', () => {
    const patcher = createIIPStreamPatcher()
    const input = `${ESC}]1337;File=name=a.png;:data${ESC}`
    const output = patcher(input)
    // First flush: should output the patched header and data, but hold \x1b
    expect(output).toBe(`${ESC}]1337;File=size=0;name=a.png;:data`)

    const out2 = patcher(']1337;File=name=b.png;:data2')
    expect(out2).toBe(`${ESC}]1337;File=size=0;name=b.png;:data2`)
  })

  it('emits non-IIP data before a marker and patches the marker', () => {
    const patcher = createIIPStreamPatcher()
    const input = `before${ESC}]1337;File=name=x.png;:data`
    const output = patcher(input)
    expect(output).toBe(`before${ESC}]1337;File=size=0;name=x.png;:data`)
  })

  it('handles consecutive chunks each ending with a possible marker prefix', () => {
    const patcher = createIIPStreamPatcher()
    // Each chunk: emit text before the trailing partial marker, hold the marker
    expect(patcher('a\x1b')).toBe('a')
    expect(patcher('b\x1b')).toBe('\x1bb')
    expect(patcher('c\x1b')).toBe('\x1bc')
  })

  it('flushes held partial marker when next chunk does not continue it', () => {
    const patcher = createIIPStreamPatcher()
    expect(patcher('\x1b')).toBe('')          // holds \x1b
    expect(patcher('\n')).toBe('\x1b\n')       // \n doesn't continue marker → flush both
  })

  it('holds payload tail that is entirely a marker prefix for next chunk', () => {
    const patcher = createIIPStreamPatcher()
    const input = `${ESC}]1337;File=name=a.png;:\x1b`
    // Payload is a lone `\x1b`: fewer than the 4 base64 chars needed to sniff
    // TIFF and no terminator yet, so the whole sequence (header included) is
    // held until the sniff becomes decidable. The byte stream that eventually
    // comes out is identical — only the per-call split differs.
    expect(patcher(input)).toBe('')
    expect(patcher(']1337;File=name=b.png;:data')).toBe(
      `${ESC}]1337;File=size=0;name=a.png;:${ESC}]1337;File=size=0;name=b.png;:data`
    )
  })
})
// ── TIFF → PNG transcode ─────────────────────────────────────────────

function b64encode(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[])
  }
  return btoa(bin)
}

function b64decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Build a TIFF in the fixed layout chafa uses for IIP (LE, RGBA8, one strip). */
function makeChafaTiffB64(width: number, height: number, rgba: Uint8Array): string {
  const imageBytes = width * height * 4
  const ifdOffset = 8 + imageBytes
  const tags: Array<[number, number, number, number]> = [
    [256, 4, 1, width], // ImageWidth
    [257, 4, 1, height], // ImageLength
    [259, 3, 1, 1], // Compression: none
    [262, 3, 1, 2], // Photometric: RGB
    [273, 4, 1, 8], // StripOffsets: right after the 8-byte header
    [277, 3, 1, 4], // SamplesPerPixel: RGBA
    [278, 4, 1, height], // RowsPerStrip
    [279, 4, 1, imageBytes], // StripByteCounts
    [284, 3, 1, 1] // PlanarConfiguration: contiguous
  ]
  const buf = new Uint8Array(ifdOffset + 2 + tags.length * 12 + 4)
  const dv = new DataView(buf.buffer)
  dv.setUint32(0, 0x002a4949, true)
  dv.setUint32(4, ifdOffset, true)
  buf.set(rgba, 8)
  dv.setUint16(ifdOffset, tags.length, true)
  tags.forEach(([tag, type, count, val], i) => {
    const off = ifdOffset + 2 + i * 12
    dv.setUint16(off, tag, true)
    dv.setUint16(off + 2, type, true)
    dv.setUint32(off + 4, count, true)
    dv.setUint32(off + 8, val, true)
  })
  dv.setUint32(ifdOffset + 2 + tags.length * 12, 0, true) // next IFD: none
  return b64encode(buf)
}

/** Assert the PNG is structurally valid and pixel-exact against the source RGBA. */
function expectPngRoundTrip(pngB64: string, width: number, height: number, rgba: Uint8Array): void {
  const png = b64decode(pngB64)
  const dv = new DataView(png.buffer)
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  expect(dv.getUint32(8)).toBe(13)
  expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR')
  expect(dv.getUint32(16)).toBe(width)
  expect(dv.getUint32(20)).toBe(height)
  expect(png[24]).toBe(8) // bit depth
  expect(png[25]).toBe(6) // color type: RGBA

  const idatLen = dv.getUint32(33)
  expect(String.fromCharCode(...png.subarray(37, 41))).toBe('IDAT')
  expect(png[41]).toBe(0x78) // zlib CMF
  expect(png[42]).toBe(0x01) // zlib FLG

  // Walk the stored deflate blocks and reassemble the filtered scanlines.
  const rowBytes = width * 4
  const rawLen = height * (1 + rowBytes)
  const raw = new Uint8Array(rawLen)
  let p = 43
  let off = 0
  for (;;) {
    const bfinal = png[p++]
    const len = png[p++] | (png[p++] << 8)
    const nlen = png[p++] | (png[p++] << 8)
    expect(nlen).toBe(~len & 0xffff)
    raw.set(png.subarray(p, p + len), off)
    off += len
    p += len
    if (bfinal === 1) break
  }
  expect(off).toBe(rawLen)
  expect(p).toBe(41 + idatLen - 4) // the trailing 4 bytes are the adler32

  expect(dv.getUint32(45 + idatLen)).toBe(0) // IEND length
  expect(String.fromCharCode(...png.subarray(49 + idatLen, 53 + idatLen))).toBe('IEND')

  for (let y = 0; y < height; y++) {
    expect(raw[y * (1 + rowBytes)]).toBe(0) // filter: none
    expect(Array.from(raw.subarray(y * (1 + rowBytes) + 1, (y + 1) * (1 + rowBytes)))).toEqual(
      Array.from(rgba.subarray(y * rowBytes, (y + 1) * rowBytes))
    )
  }
}

describe('TIFF transcode', () => {
  it('transcodes a chafa TIFF payload to PNG, preserving pixels and header fields', () => {
    // 2x2: red, green / blue, yellow
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255])
    const input = `${ESC}]1337;File=inline=1;width=2;height=1;preserveAspectRatio=0:${makeChafaTiffB64(2, 2, rgba)}\x07`
    const out = createIIPStreamPatcher()(input)
    const m = out.match(/^\x1b\]1337;File=(.*):([A-Za-z0-9+/=]+)\x07$/)
    expect(m).not.toBeNull()
    // the injected size is the real decoded PNG length (addon-image aborts on 0)
    const declared = Number(m![1].match(/(?:^|;)size=(\d+)/)![1])
    expect(declared).toBe(b64decode(m![2]).length)
    expect(declared).toBeGreaterThan(0)
    expect(m![1]).toContain('width=2') // cell dims preserved
    expect(m![1]).toContain('preserveAspectRatio=0')
    expectPngRoundTrip(m![2], 2, 2, rgba)
  })

  it('round-trips a payload large enough to span multiple deflate stored blocks', () => {
    // 130x130x4 + 130 filter bytes = 67730 raw bytes > 65535 → two blocks
    const width = 130
    const height = 130
    const rgba = new Uint8Array(width * height * 4)
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 31 + 7) & 0xff
    const input = `${ESC}]1337;File=inline=1;:${makeChafaTiffB64(width, height, rgba)}\x07`
    const out = createIIPStreamPatcher()(input)
    const m = out.match(/:([A-Za-z0-9+/=]+)\x07$/)
    expect(m).not.toBeNull()
    expectPngRoundTrip(m![1], width, height, rgba)
  })

  it('transcodes a TIFF payload split into single-character chunks', () => {
    const rgba = new Uint8Array([10, 20, 30, 40])
    const full = `${ESC}]1337;File=inline=1;width=1;height=1;:${makeChafaTiffB64(1, 1, rgba)}\x07`
    const patcher = createIIPStreamPatcher()
    let out = ''
    for (const ch of full) out += patcher(ch)
    const m = out.match(/:([A-Za-z0-9+/=]+)\x07$/)
    expect(m).not.toBeNull()
    expectPngRoundTrip(m![1], 1, 1, rgba)
  })

  it('accepts ST (ESC \\) as the TIFF payload terminator', () => {
    const rgba = new Uint8Array([1, 2, 3, 255])
    const input = `${ESC}]1337;File=inline=1;:${makeChafaTiffB64(1, 1, rgba)}${ESC}\\`
    const out = createIIPStreamPatcher()(input)
    const m = out.match(/:([A-Za-z0-9+/=]+)\x1b\\$/)
    expect(m).not.toBeNull()
    expectPngRoundTrip(m![1], 1, 1, rgba)
  })

  it('passes non-TIFF payloads (PNG) through byte-identically', () => {
    const pngB64 = b64encode(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]))
    const input = `${ESC}]1337;File=inline=1;size=100;:${pngB64}\x07`
    // size already present + non-TIFF → nothing to do at all
    expect(createIIPStreamPatcher()(input)).toBe(input)
  })

  it('re-emits a malformed TIFF payload unchanged (stream stays valid)', () => {
    const badTiffB64 = b64encode(new Uint8Array([0x49, 0x49, 0x2a, 0x00, 0xff, 0xff, 0xff, 0xff])) // bad IFD offset
    const input = `${ESC}]1337;File=inline=1;:${badTiffB64}\x07tail`
    const out = createIIPStreamPatcher()(input)
    // base64 decoded fine (8 bytes) but TIFF parse failed → raw payload, real size
    expect(out).toBe(`${ESC}]1337;File=size=8;inline=1;:${badTiffB64}\x07tail`)
  })
})
describe('chunk boundary regression', () => {
  it('does not re-emit the image when the BEL terminator is the last byte of a chunk', () => {
    // Regression: after a successful TIFF emit the held buffer was not cleared,
    // so when BEL arrived as a chunk's final byte, the next chunk re-processed
    // the whole image and a later OSC's ST became a phantom terminator —
    // emitting a corrupt second copy that swallowed the shell prompt.
    const rgba = new Uint8Array([10, 20, 30, 40])
    const imageChunk = `${ESC}]1337;File=inline=1;:${makeChafaTiffB64(1, 1, rgba)}\x07`
    const nextChunk = `\r\n${ESC}]7;file://localhost/x${ESC}\\prompt$ `
    const patcher = createIIPStreamPatcher()
    const out1 = patcher(imageChunk)
    const out2 = patcher(nextChunk)
    expect((out1 + out2).match(/\x1b\]1337/g)!.length).toBe(1)
    expect(out2).toBe(nextChunk) // tail flows through untouched
    const m = out1.match(/:([A-Za-z0-9+/=]+)\x07$/)
    expect(m).not.toBeNull()
    expectPngRoundTrip(m![1], 1, 1, rgba)
  })
})
