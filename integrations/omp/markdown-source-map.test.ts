import { expect, test } from 'bun:test'
import { Markdown } from '@oh-my-pi/pi-tui/components/markdown'
import { getMarkdownTheme } from '@oh-my-pi/pi-tui/theme'
import { sourceRows } from './markdown-source-map'
import { rangeMarkdownTheme, sourceWindow } from './markdown-range'
import { stripTerminalSequences } from '@oh-my-pi/pi-tui/utils'

for (const source of [
  'A **bold sentence with several words** and `inline code` ends here.',
  '- first item with **bold wrapping words** and 中文字符\n  - nested emoji 😀😀 and more words\n- final item',
  '```ts\nconst 中文 = "😀 abcdefghijklmnopqrstuvwxyz";\nreturn 中文;\n```',
  '> quoted **formatted words** with wide 中文 and emoji 👨‍👩‍👧‍👦 text',
]) {
  test(`source spans preserve canonical rows for ${source.slice(0, 20)}`, () => {
    const window = sourceWindow(source, 0, 100, 100)
    const theme = rangeMarkdownTheme(source, window, getMarkdownTheme())
    for (const width of [18, 31, 54]) {
      const original = new Markdown(source, 1, 0, theme)
      const mapped = new Markdown(source, 1, 0, theme)
      mapped.setSourceMapping(true)
      const rows = sourceRows(mapped.render(width))
      expect(rows.map(row => row.text)).toEqual(original.render(width))
      const sourced = rows.filter(row => row.start !== undefined)
      expect(sourced.length).toBeGreaterThan(0)
      for (const row of sourced) {
        expect(row.start).toBeGreaterThanOrEqual(0)
        expect(row.end).toBeLessThanOrEqual(source.length)
      }
      const contentRows = rows.filter(row => row.start !== undefined && row.start !== row.end)
      expect(new Set(contentRows.map(row => row.start)).size).toBe(contentRows.length)
    }
  })
}

test('row spans name literal original source points after inline formatting and hanging indentation', () => {
  const source = '- first **bold words** and 中文字符 end\n- next item'
  const markdown = new Markdown(source, 1, 0, rangeMarkdownTheme(source, sourceWindow(source, 0, 100, 100), getMarkdownTheme()))
  markdown.setSourceMapping(true)
  const rows = sourceRows(markdown.render(18))
  expect(rows.map(row => ({ text: stripTerminalSequences(row.text).trimEnd(), start: row.start, end: row.end }))).toEqual([
    { text: ' - first bold', start: 2, end: 14 },
    { text: '   words and 中文', start: 15, end: 29 },
    { text: '   字符 end', start: 30, end: 34 },
    { text: ' - next item', start: 38, end: 46 },
  ])
})

test('code body source positions never point into an identical fence language label', () => {
  const source = '```ts\nts\n```'
  const markdown = new Markdown(source, 1, 0, rangeMarkdownTheme(source, sourceWindow(source, 0, 100, 100), getMarkdownTheme()))
  markdown.setSourceMapping(true)
  const body = sourceRows(markdown.render(18)).find(row => stripTerminalSequences(row.text).trim() === 'ts')
  expect(body?.start).toBe(6)
  expect(body?.end).toBe(7)
})

test('maps unmarked rendered rows back to the supplied source window', () => {
  const source = 'first line\nsecond line with **bold words**\nthird line'
  const window = sourceWindow(source, 0, 100, 100)
  const markdown = new Markdown(window.markdown, 1, 0, rangeMarkdownTheme(source, window, getMarkdownTheme()))
  const rows = sourceRows(markdown.render(40), window.markdown)
  expect(rows.filter(row => row.text.trim()).every(row => row.start !== undefined)).toBe(true)
  expect(rows.find(row => row.text.includes('first line'))?.start).toBe(0)
})
