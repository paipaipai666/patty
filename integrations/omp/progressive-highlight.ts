import { Worker } from 'node:worker_threads'
import type { HighlightColors } from '@oh-my-pi/pi-natives'
import type { MarkdownTheme } from '@oh-my-pi/pi-tui/components/markdown'
import { theme } from '@oh-my-pi/pi-tui/theme/theme'
import { rangeMarkdownTheme, syntaxSourceRange, type MarkdownSourceWindow } from './markdown-range'

export interface HighlightRequest {
	id: number
	code: string
	language: string
	prefix: string
	suffix: string
	colors: HighlightColors
}

export type HighlightReply =
	| { kind: 'started'; id: number }
	| { kind: 'complete'; id: number; lines: string[] }
	| { kind: 'failed'; id: number }

export interface ProgressiveHighlightOptions {
	key: { sessionId: string; viewId: string; entryId: string; partId: string; contentRevision: number }
	isCurrent: () => boolean
	requestRender: () => void
}

interface Job {
	key: string
	request: HighlightRequest
	options: ProgressiveHighlightOptions
}

const cache = new Map<string, string[]>()
const failed = new Set<string>()
let cacheSize = 0
let worker: Worker | undefined
let active: Job | undefined
let pending: Job | undefined
let sequence = 0
let workersStarted = 0
let completedJobs = 0
let startedJobs = 0
let discardedResults = 0

function palette(): HighlightColors {
	return {
		comment: theme.getFgAnsi('syntaxComment'), keyword: theme.getFgAnsi('syntaxKeyword'),
		function: theme.getFgAnsi('syntaxFunction'), variable: theme.getFgAnsi('syntaxVariable'),
		string: theme.getFgAnsi('syntaxString'), number: theme.getFgAnsi('syntaxNumber'),
		type: theme.getFgAnsi('syntaxType'), operator: theme.getFgAnsi('syntaxOperator'),
		punctuation: theme.getFgAnsi('syntaxPunctuation'), inserted: theme.getFgAnsi('toolDiffAdded'),
		deleted: theme.getFgAnsi('toolDiffRemoved')
	}
}

function remember(key: string, lines: string[]): void {
	const size = key.length + lines.reduce((total, line) => total + line.length, 0)
	if (size > 256 * 1024) return
	cache.set(key, lines)
	cacheSize += size
	while (cache.size > 64 || cacheSize > 2 * 1024 * 1024) {
		const oldest = cache.entries().next()
		if (oldest.done) break
		cache.delete(oldest.value[0])
		cacheSize -= oldest.value[0].length + oldest.value[1].reduce((total, line) => total + line.length, 0)
	}
}

function start(job: Job): void {
	if (!job.options.isCurrent()) return
	if (!worker) {
		const created = new Worker(new URL('./highlight-worker.ts', import.meta.url))
		worker = created
		workersStarted++
		created.on('message', (reply: HighlightReply) => {
			if (worker !== created) return
			const finished = active
			if (!finished || reply.id !== finished.request.id) return
			if (reply.kind === 'started') {
				startedJobs++
				return
			}
			active = undefined
			completedJobs++
			if (finished.options.isCurrent()) {
				if (reply.kind === 'complete') remember(finished.key, reply.lines)
				else {
					failed.add(finished.key)
					if (failed.size > 64) failed.delete(failed.values().next().value ?? '')
				}
				finished.options.requestRender()
			} else discardedResults++
			const next = pending
			pending = undefined
			if (next) start(next)
		})
		const onFailure = () => {
			if (worker !== created) return
			worker = undefined
			if (active) {
				failed.add(active.key)
				if (failed.size > 64) failed.delete(failed.values().next().value ?? '')
			}
			active = undefined
			const next = pending
			pending = undefined
			if (next) start(next)
		}
		created.on('error', onFailure)
		created.on('exit', onFailure)
		created.unref()
	}
	active = job
	worker.postMessage(job.request)
}

function enqueue(job: Job): void {
	if (active?.key === job.key) {
		active.options = job.options
		return
	}
	if (active) pending = job
	else start(job)
}

export function progressiveRangeTheme(source: string, window: MarkdownSourceWindow, originalTheme: MarkdownTheme, options: ProgressiveHighlightOptions): MarkdownTheme {
	const base = rangeMarkdownTheme(source, window, originalTheme)
	const colors = palette()
	return {
		...base,
		highlightCode: (code, language) => {
			const plain = () => code.split('\n').map(line => originalTheme.codeBlock(line))
			if (!language || !options.isCurrent()) return plain()
			const key = JSON.stringify([options.key.sessionId, options.key.entryId, options.key.partId, options.key.contentRevision, window.startOffset, window.endOffset, code, language, colors])
			const hit = cache.get(key)
			if (hit) return [...hit]
			if (!failed.has(key)) {
				const context = syntaxSourceRange(source, window, code, language)
				if (!context && window.needsContext) return plain()
				enqueue({ key, options, request: { id: ++sequence, code, language, prefix: context?.prefix ?? '', suffix: context?.suffix ?? '', colors } })
			}
			return plain()
		}
	}
}

export function progressiveHighlightState() {
	return { running: active ? 1 : 0, pending: pending ? 1 : 0, workersStarted, startedJobs, completedJobs, discardedResults, cachedEntries: cache.size, cacheSize }
}

export async function disposeProgressiveHighlighting(): Promise<void> {
	const previous = worker
	worker = undefined
	active = undefined
	pending = undefined
	cache.clear()
	failed.clear()
	cacheSize = 0
	workersStarted = 0
	completedJobs = 0
	startedJobs = 0
	discardedResults = 0
	await previous?.terminate()
}
