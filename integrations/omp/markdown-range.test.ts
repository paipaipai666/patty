import { expect, test } from 'bun:test'
import { rangeMarkdownTheme, sourceWindow, syntaxSourceRange } from './markdown-range'
import { Markdown } from './node_modules/@oh-my-pi/pi-tui/src/components/markdown'
import { getMarkdownTheme } from './node_modules/@oh-my-pi/pi-tui/src/theme/theme'

test('a long fenced reply reaches the native renderer as a bounded source window', () => {
	const text = '```typescript\nconst first = 1\n' + 'const hidden = 2\n'.repeat(20_000) + '```'
	const window = sourceWindow(text, 0, 6, 60)
	expect(window.startOffset).toBe(0)
	expect(window.endOffset).toBeGreaterThan(0)
	expect(window.endOffset).toBeLessThan(400)
	expect(window.markdown.length).toBeLessThan(450)
	expect(window.needsContext).toBe(false)
	const rendered = new Markdown(window.markdown, 0, 0, getMarkdownTheme()).render(60).join('\n')
	expect(rendered).toContain('first')
	expect(rendered).not.toContain('const hidden = 2\n'.repeat(100))
})

test('a window inside a fenced multiline comment retains the original syntax prefix', () => {
	const text = '```typescript\n/* start\nreturn 42\n*/\nconst after = 1\n```'
	const window = sourceWindow(text, text.indexOf('return'), 4, 60)
	expect(syntaxSourceRange(text, window, 'return 42\n*/', 'typescript')).toEqual({ prefix: '/* start\n', suffix: '\n' })
})

test('paging over a closing fence does not open a code block around the following prose', () => {
	const text = '```ts\none\n```\nafter\n'
	const first = sourceWindow(text, 0, 4, 60)
	expect(first.endOffset).toBe(14)
	const second = sourceWindow(text, first.endOffset, 4, 60)
	expect(second.markdown).toBe('after\n')
	expect(second.startOffset).toBe(14)
})

test('a million-character single line sends only the source window to the native renderer', () => {
	const text = 'x'.repeat(1_000_000)
	const window = sourceWindow(text, 0, 6, 44)
	expect(window.markdown).toBe('x'.repeat(160))
	expect(window.endOffset).toBe(160)
	expect(window.needsContext).toBe(true)
	expect(new Markdown(window.markdown, 0, 0, getMarkdownTheme()).render(44).length).toBeLessThanOrEqual(6)
})

test('native cell widths preserve single-cell accented graphemes and complete emoji', () => {
	const accented = sourceWindow('é'.repeat(40), 0, 3, 12)
	expect(accented.markdown).toBe('é'.repeat(8))
	const combined = sourceWindow('e\u0301'.repeat(40), 1, 3, 12)
	expect(combined.startOffset).toBe(0)
	expect(combined.markdown).toBe('e\u0301'.repeat(8))
	const emoji = sourceWindow('👩‍💻'.repeat(40), 2, 3, 12)
	expect(emoji.startOffset).toBe(0)
	expect(emoji.markdown).toBe('👩‍💻'.repeat(4))
})

test('a fenced continuation ends before another code block can inherit its syntax state', () => {
	const text = '```ts\n/* start\nhidden\n```\n\n```ts\nreturn 42\n```'
	const window = sourceWindow(text, text.indexOf('hidden'), 20, 60)
	expect(window.markdown).toBe('```ts\nhidden\n```\n')
	expect(window.endOffset).toBe(text.indexOf('\n\n') + 1)
})

test('a partial line inside a 40k code string renders before syntax highlighting', () => {
	const text = '```typescript\nconst value = "' + 'x'.repeat(40_000) + '";\n```'
	const start = performance.now()
	const window = sourceWindow(text, text.indexOf('xxxxx') + 20_000, 6, 44)
	const rows = new Markdown(window.markdown, 0, 0, rangeMarkdownTheme(text, window, getMarkdownTheme())).render(44)
	expect(performance.now() - start).toBeLessThan(500)
	expect(rows.some(line => line.includes('xxxxx'))).toBe(true)
	expect(window.markdown.length).toBeLessThan(200)
})
