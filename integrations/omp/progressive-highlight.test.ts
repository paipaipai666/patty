import { afterEach, expect, test } from 'bun:test'
import { Markdown } from '@oh-my-pi/pi-tui/components/markdown'
import { getMarkdownTheme, theme } from '@oh-my-pi/pi-tui/theme/theme'
import { sliceByColumn, visibleWidth } from '@oh-my-pi/pi-tui/utils'
import { sourceWindow } from './markdown-range'
import { disposeProgressiveHighlighting, progressiveHighlightState, progressiveRangeTheme } from './progressive-highlight'

afterEach(async () => {
	await disposeProgressiveHighlighting()
})

function renderProgressively(source: string, offset: number, requestRender: () => void, isCurrent = () => true, revision = 1) {
	const window = sourceWindow(source, offset, 6, 44)
	const renderTheme = progressiveRangeTheme(source, window, getMarkdownTheme(), {
		key: { sessionId: 'session', viewId: 'view', entryId: 'entry', partId: 'part', contentRevision: revision },
		isCurrent,
		requestRender
	})
	return { window, rows: new Markdown(window.markdown, 0, 0, renderTheme).render(44) }
}

test('a 40k-character code line renders its target before native syntax parsing completes', async () => {
	const script = `
import { Markdown } from '@oh-my-pi/pi-tui/components/markdown';
import { getMarkdownTheme, theme } from '@oh-my-pi/pi-tui/theme/theme';
import { sourceWindow } from './markdown-range';
import { progressiveRangeTheme, progressiveHighlightState } from './progressive-highlight';
const source = '\x60\x60\x60typescript\\nconst value = "' + 'x'.repeat(40_000) + '";\\n\x60\x60\x60';
const start = performance.now();
const window = sourceWindow(source, source.indexOf('xxxxx') + 20_000, 6, 44);
const renderTheme = progressiveRangeTheme(source, window, getMarkdownTheme(), {
 key: { sessionId: 'session', viewId: 'view', entryId: 'entry', partId: 'part', contentRevision: 1 },
 isCurrent: () => true, requestRender: () => {}
});
const rows = new Markdown(window.markdown, 0, 0, renderTheme).render(44);
const frameMs = performance.now() - start;
while (progressiveHighlightState().startedJobs === 0) await Bun.sleep(5);
await Bun.sleep(30);
process.stdout.write(JSON.stringify({ frameMs, visible: rows.some(row => row.includes('xxxxx')), syntax: rows.join('').includes(theme.getFgAnsi('syntaxString')), sourceSize: window.markdown.length, ...progressiveHighlightState() }) + '\\n');
setInterval(() => {}, 1000);
`
	const child = Bun.spawn([process.execPath, '--eval', script], { cwd: import.meta.dir, stdout: 'pipe', stderr: 'pipe' })
	try {
		const reader = child.stdout.getReader()
		const result = await reader.read()
		const evidence: unknown = JSON.parse(new TextDecoder().decode(result.value))
		expect(evidence).toMatchObject({ visible: true, syntax: false, running: 1, startedJobs: 1, completedJobs: 0 })
		if (typeof evidence !== 'object' || evidence === null || !('frameMs' in evidence) || typeof evidence.frameMs !== 'number' || !('sourceSize' in evidence) || typeof evidence.sourceSize !== 'number') throw new Error('Missing responsiveness evidence')
		expect(evidence.frameMs).toBeLessThan(500)
		expect(evidence.sourceSize).toBeLessThan(200)
		await reader.cancel()
	} finally {
		child.kill()
		await child.exited
	}
})

test('background syntax colors retain multiline grammar and the source anchor', async () => {
	const source = '```typescript\n/* start\nreturn 42\n*/\nconst after = 1\n```'
	let resolveRender: () => void = () => {}
	const completed = new Promise<void>(resolve => { resolveRender = resolve })
	const first = renderProgressively(source, source.indexOf('return'), resolveRender)
	await completed
	const next = renderProgressively(source, source.indexOf('return'), () => {})
	const full = new Markdown(source, 0, 0, getMarkdownTheme()).render(44)
	const normalize = (row: string | undefined) => row?.replace(/\x1b\[39m(?=\x1b\[38;)/g, '')
	expect(normalize(next.rows.find(row => row.includes('return')))).toBe(normalize(full.find(row => row.includes('return'))))
	expect(next.window.startOffset).toBe(first.window.startOffset)
	expect(progressiveHighlightState().cachedEntries).toBe(1)
})

test('the final visible partial line uses its original right-hand grammar context', async () => {
	const source = '```typescript\nconst value = "' + 'x'.repeat(180) + '";\n```'
	let resolveRender: () => void = () => {}
	const completed = new Promise<void>(resolve => { resolveRender = resolve })
	const offset = source.indexOf('xxxxx') + 90
	renderProgressively(source, offset, resolveRender)
	await completed
	const next = renderProgressively(source, offset, () => {})
	expect(next.rows.find(row => row.includes('xxxxx'))).toContain(theme.getFgAnsi('syntaxString'))
	expect(next.window.startOffset).toBe(offset)
})

test('a window ending inside a function name retains native lookahead beyond its right edge', async () => {
	const source = '```typescript\nconst result = veryLongFunctionName();\n```'
	const offset = source.indexOf('veryLong')
	const window = sourceWindow(source, offset, 3, 12)
	let resolveRender: () => void = () => {}
	const completed = new Promise<void>(resolve => { resolveRender = resolve })
	const original = getMarkdownTheme()
	const progressive = progressiveRangeTheme(source, window, original, {
		key: { sessionId: 'session', viewId: 'view', entryId: 'entry', partId: 'part', contentRevision: 1 },
		isCurrent: () => true,
		requestRender: () => resolveRender()
	})
	new Markdown(window.markdown, 0, 0, progressive).render(12)
	await completed
	const wholeLine = original.highlightCode?.('const result = veryLongFunctionName();', 'typescript')[0] ?? ''
	const expected = sliceByColumn(wholeLine, visibleWidth('const result = '), visibleWidth('veryLong'))
	const normalize = (value: string) => value.replace(/\x1b\[39m(?=\x1b\[38;)/g, '')
	expect(window.markdown).toBe('```typescript\nveryLong\n```')
	expect(progressive.highlightCode?.('veryLong', 'typescript').map(normalize)).toEqual([normalize(expected)])
})

test('obsolete view results do not request a render or enter the cache', async () => {
	let current = true
	let renders = 0
	renderProgressively('```typescript\nconst before = 1\n```', 0, () => { renders++ }, () => current)
	current = false
	while (progressiveHighlightState().running > 0) await new Promise(resolve => setTimeout(resolve, 10))
	expect(renders).toBe(0)
	expect(progressiveHighlightState().cachedEntries).toBe(0)
	expect(progressiveHighlightState().discardedResults).toBe(1)
})

test('rapid seeks retain one running job and only the newest pending revision', async () => {
	let renders = 0
	let currentRevision = 0
	for (let revision = 1; revision <= 8; revision++) {
		currentRevision = revision
		renderProgressively('```typescript\nconst version = ' + revision + '\n```', 0, () => { renders++ }, () => currentRevision === revision, revision)
	}
	expect(progressiveHighlightState().workersStarted).toBe(1)
	expect(progressiveHighlightState().running).toBe(1)
	expect(progressiveHighlightState().pending).toBe(1)
	while (progressiveHighlightState().running > 0) await new Promise(resolve => setTimeout(resolve, 10))
	expect(renders).toBe(1)
	expect(progressiveHighlightState().completedJobs).toBe(2)
	expect(progressiveHighlightState().cachedEntries).toBe(1)
})
