import { Terminal } from '@xterm/xterm'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { registerOsc7Handler } from '../../../utils/osc7Handler'
import { cellAlignedLines, createIipStreamExtractor, findIipSlot } from '../iipParser'
import { createIIPStreamPatcher } from '../iipStreamPatcher'
import programStatusFixtures from '../../../../shared/__fixtures__/program-status.json'

const esc = '\x1b'
const csi = `${esc}[`
const osc = `${esc}]`
const st = `${esc}\\`
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII='

let terminal: Terminal

function write(data: string | Uint8Array): Promise<void> {
  return new Promise((resolve) => terminal.write(data, resolve))
}

function line(row: number): string | undefined {
  return terminal.buffer.active.getLine(row)?.translateToString(true)
}

describe('terminal protocol compatibility with real xterm', () => {
  beforeEach(() => {
    terminal = new Terminal({ cols: 12, rows: 4, scrollback: 10, allowProposedApi: true })
    terminal.loadAddon(new Unicode11Addon())
    terminal.unicode.activeVersion = '11'
  })

  afterEach(() => terminal.dispose())

  it.each(programStatusFixtures)('preserves text and cursor for OSC 7501: $name', async fixture => {
    const replies: string[] = []
    terminal.onData(data => replies.push(data))
    for (const byte of new TextEncoder().encode(fixture.output)) await write(Uint8Array.of(byte))
    expect([line(0), line(1)].join('\n')).toBe(fixture.text)
    expect(terminal.buffer.active.cursorX).toBe(5)
    expect(replies).toEqual([])
  })

  it('keeps command markers invisible and preserves the prompt and command output', async () => {
    await write(`${osc}133;A\x07PS> ${osc}133;B${st}`)
    await write(`${osc}133;C\x07hello\r\n${osc}133;D;7${esc}`)
    await write(`\\${osc}133;A\x07PS> ${osc}133;B\x07`)
    expect([line(0), line(1)]).toEqual(['PS> hello', 'PS> '])
    expect(terminal.buffer.active.cursorX).toBe(4)
  })

  it('preserves UTF-8 split at every byte and aligns wide glyphs', async () => {
    for (const byte of new TextEncoder().encode('中🙂!')) await write(Uint8Array.of(byte))
    expect(line(0)).toBe('中🙂!')
    const row = terminal.buffer.active.getLine(0)
    expect([0, 1, 2, 3, 4].map((col) => row?.getCell(col)?.getWidth())).toEqual([2, 0, 2, 0, 1])
    expect(terminal.buffer.active.cursorX).toBe(5)
  })

  it('recognizes a cwd OSC split across writes including the terminator', async () => {
    const directories: [string, string][] = []
    registerOsc7Handler(terminal, 'fixture', (id, cwd) => directories.push([id, cwd]))
    await write(`${osc}7;file:///D:/code/my%`)
    await write(`20project${esc}`)
    await write('\\ready')
    expect(directories).toEqual([['fixture', 'D:\\code\\my project']])
    expect(line(0)).toBe('ready')
  })

  it('restores the primary screen and its cursor after alternate screen use', async () => {
    await write('primary\r\nnext')
    await write(`${csi}?1049h${csi}Hfull screen`)
    expect(terminal.buffer.active.type).toBe('alternate')
    expect(line(0)).toBe('full screen')
    await write(`${csi}?1049l!`)
    expect(terminal.buffer.active.type).toBe('normal')
    expect([line(0), line(1)]).toEqual(['primary', 'next!'])
    expect(terminal.buffer.active.cursorY).toBe(1)
  })

  it('sends cursor position replies in stream order', async () => {
    const replies: string[] = []
    terminal.onData((data) => replies.push(data))
    await write(`${csi}2;3H${csi}6`)
    await write(`nX${csi}6n`)
    expect(replies).toEqual([`${csi}2;3R`, `${csi}2;4R`])
    expect(line(1)).toBe('  X')
  })

  it('reflows wrapped scrollback when widening and preserves the current prompt', async () => {
    await write('abcdefghijklmnop\r\nsecond\r\nthird\r\nPS> ')
    expect(line(0)).toBe('abcdefghijkl')
    expect(terminal.buffer.active.baseY).toBe(1)
    terminal.resize(20, 4)
    expect([line(0), line(1), line(2), line(3)]).toEqual(['abcdefghijklmnop', 'second', 'third', 'PS> '])
    expect(terminal.buffer.active.cursorX).toBe(4)
  })

  it('keeps text intact inside a synchronized output sequence', async () => {
    await write(`${csi}?2026h${csi}2J${csi}Hfirst`)
    await write(`\r\nsecond${csi}?2026l`)
    expect([line(0), line(1)]).toEqual(['first', 'second'])
    expect(terminal.buffer.active.cursorY).toBe(1)
  })

  it('anchors a split inline image after a double-width cell', async () => {
    const patch = createIIPStreamPatcher()
    const extract = createIipStreamExtractor()
    const frame = `${osc}1337;File=inline=1;width=1;height=1:${png}${st}`
    const parts = [`中${frame.slice(0, 9)}`, frame.slice(9, -1), `${frame.slice(-1)}!`]
    const images = []
    for (const part of parts) {
      const result = extract(patch(part))
      images.push(...result.images)
      await write(result.out)
    }
    expect(images.map(({ dataUrl }) => dataUrl)).toEqual([`data:image/png;base64,${png}`])
    expect(findIipSlot(cellAlignedLines(terminal.buffer.active), images[0].slot)).toEqual({ row: 0, col: 2 })
    expect(line(0)).toBe(`中${images[0].slot}!`)
  })
})
