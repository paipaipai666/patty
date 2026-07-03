import { describe, it, expect } from 'vitest'
import { createIIPStreamPatcher } from './iipStreamPatcher'

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
})
