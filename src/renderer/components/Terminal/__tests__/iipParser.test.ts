import { describe, it, expect } from 'vitest'
import {
  buildIipImage,
  createIipStreamExtractor,
  parseIipFileHeader,
  sniffMimeFromBase64,
} from '../iipParser'

const ESC = '\x1b'

/** 1×1 PNG (89 50 4E 47 …) as base64 — same fixture as iipStreamPatcher tests. */
const PNG_B64 = btoa(
  String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3)
)

describe('parseIipFileHeader', () => {
  it('parses omp encodeITerm2 shape: inline=1 width=N height=auto', () => {
    const h = parseIipFileHeader('inline=1;width=20;height=auto')
    expect(h.inline).toBe(1)
    expect(h.width).toBe('20')
    expect(h.height).toBe('auto')
    expect(h.size).toBeUndefined()
  })

  it('parses size, name, preserveAspectRatio', () => {
    const h = parseIipFileHeader('inline=1;size=11;name=dGVzdA==;preserveAspectRatio=0;width=10px')
    expect(h.inline).toBe(1)
    expect(h.size).toBe(11)
    expect(h.name).toBe('dGVzdA==') // decoded later by buildIipImage
    expect(h.preserveAspectRatio).toBe(0)
    expect(h.width).toBe('10px')
  })

  it('defaults inline to 0 when absent', () => {
    expect(parseIipFileHeader('name=x;size=1').inline).toBe(0)
  })
})

describe('sniffMimeFromBase64', () => {
  it('detects PNG / JPEG / GIF / WebP prefixes', () => {
    expect(sniffMimeFromBase64('iVBORw0KGgo')).toBe('image/png')
    expect(sniffMimeFromBase64('/9j/4AAQ')).toBe('image/jpeg')
    expect(sniffMimeFromBase64('R0lGODlh')).toBe('image/gif')
    expect(sniffMimeFromBase64('UklGRg')).toBe('image/webp')
    expect(sniffMimeFromBase64('AAAA')).toBeNull()
  })
})

describe('buildIipImage', () => {
  it('builds a data URL and decodes name', () => {
    const img = buildIipImage('inline=1;name=dGVzdA==;width=2', PNG_B64)
    expect(img.mimeType).toBe('image/png')
    expect(img.isInline).toBe(true)
    expect(img.header.name).toBe('test')
    expect(img.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(img.payloadBase64).toBe(PNG_B64)
  })
})

describe('createIipStreamExtractor', () => {
  it('extracts a complete omp-shaped IIP and plants a slot in the stream', () => {
    const extract = createIipStreamExtractor()
    const frame = `${ESC}]1337;File=inline=1;width=20;height=auto:${PNG_B64}\x07`
    const { out, images } = extract(`hello${frame}world`)
    expect(images).toHaveLength(1)
    expect(out).toBe(`hello${images[0].slot}world`)
    expect(images[0].header.width).toBe('20')
    expect(images[0].header.height).toBe('auto')
    expect(images[0].mimeType).toBe('image/png')
  })

  it('holds incomplete frames until the terminator arrives', () => {
    const extract = createIipStreamExtractor()
    const frame = `${ESC}]1337;File=inline=1;width=2:${PNG_B64}\x07`
    const mid = Math.floor(frame.length / 2)
    const r1 = extract(frame.slice(0, mid))
    expect(r1.out).toBe('')
    expect(r1.images).toHaveLength(0)
    const r2 = extract(frame.slice(mid))
    expect(r2.images).toHaveLength(1)
    expect(r2.out).toBe(r2.images[0].slot)
  })

  it('emits unique slots instead of the IIP sequence', () => {
    const extract = createIipStreamExtractor()
    const frame = `${ESC}]1337;File=inline=1:${PNG_B64}${ESC}\\`
    const { out, images } = extract(frame)
    expect(out).toBe(images[0].slot)
    expect(images[0].slot).toHaveLength(1)
  })

  it('extracts two images when frames are adjacent', () => {
    const extract = createIipStreamExtractor()
    const a = `${ESC}]1337;File=inline=1;width=1:${PNG_B64}\x07`
    const b = `${ESC}]1337;File=inline=1;width=2:${PNG_B64}\x07`
    const { out, images } = extract(a + b)
    expect(images).toHaveLength(2)
    expect(out).toBe(images[0].slot + images[1].slot)
    expect(images[0].slot).not.toBe(images[1].slot)
  })

  it('passes non-IIP data through unchanged', () => {
    const extract = createIipStreamExtractor()
    const { out, images } = extract('plain text\r\n')
    expect(out).toBe('plain text\r\n')
    expect(images).toHaveLength(0)
  })
})
