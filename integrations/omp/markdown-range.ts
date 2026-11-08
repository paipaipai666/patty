import type { MarkdownTheme } from '@oh-my-pi/pi-tui/components/markdown'
import { replaceTabs, visibleWidth } from '@oh-my-pi/pi-tui/utils'

interface Fence {
	start: number
	body: number
	end: number
	after: number
	opener: string
	closer: string
}

type RangeContext =
	| Readonly<{ kind: 'none' }>
	| Readonly<{ kind: 'fence'; prefix: string; language: string; partialLine: boolean }>

export interface MarkdownSourceWindow {
	markdown: string
	startOffset: number
	endOffset: number
	needsContext: boolean
	context: RangeContext
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const fenceCache = new Map<string, readonly Fence[]>()

function sourceFences(text: string): readonly Fence[] {
	const cached = fenceCache.get(text)
	if (cached) return cached
	const fences: Fence[] = []
	let opened: Fence | undefined
	let marker = ''
	for (let offset = 0; offset < text.length;) {
		const newline = text.indexOf('\n', offset)
		const end = newline < 0 ? text.length : newline
		const line = text.slice(offset, end).replace(/\r$/, '')
		const match = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)$/.exec(line)
		if (match) {
			const indentation = match[1] ?? ''
			const delimiter = match[2] ?? ''
			const suffix = match[3] ?? ''
			if (opened) {
				if (delimiter[0] === marker[0] && delimiter.length >= marker.length && suffix.trim() === '') {
					opened.end = offset
					opened.after = newline < 0 ? text.length : newline + 1
					opened = undefined
				}
			} else if (delimiter[0] !== '`' || !suffix.includes('`')) {
				marker = delimiter
				opened = {
					start: offset,
					body: newline < 0 ? text.length : newline + 1,
					end: text.length,
					after: text.length,
					opener: line,
					closer: indentation + delimiter
				}
				fences.push(opened)
			}
		}
		if (newline < 0) break
		offset = newline + 1
	}
	fenceCache.set(text, fences)
	if (fenceCache.size > 4) {
		const oldest = fenceCache.keys().next()
		if (!oldest.done) fenceCache.delete(oldest.value)
	}
	return fences
}

function windowEnd(text: string, start: number, rows: number, width: number): number {
	let row = 0
	let column = 0
	let end = start
	for (const { segment, index } of graphemes.segment(text.slice(start))) {
		if (segment === '\n' || segment === '\r\n') {
			end = start + index + segment.length
			row++
			column = 0
			if (row >= rows) break
			continue
		}
		const cells = segment === '\t' ? 4 : visibleWidth(segment)
		if (column > 0 && column + cells > width) {
			row++
			column = 0
		}
		if (row >= rows) break
		end = start + index + segment.length
		column += cells
	}
	return end
}

export function sourceWindow(text: string, anchorOffset: number, rowBudget: number, width: number): MarkdownSourceWindow {
	if (!Number.isFinite(anchorOffset) || !Number.isSafeInteger(rowBudget) || rowBudget < 1 || !Number.isSafeInteger(width) || width < 1) {
		throw new RangeError('Invalid Markdown source window')
	}
	const boundedAnchor = Math.max(0, Math.min(text.length, Math.trunc(anchorOffset)))
	const fences = sourceFences(text)
	let startOffset = graphemes.segment(text).containing(boundedAnchor)?.index ?? text.length
	const closingStart = fences.find(fence => fence.end <= startOffset && startOffset < fence.after)
	if (closingStart) startOffset = closingStart.after
	const initialFence = fences.find(fence => fence.body <= startOffset && startOffset < fence.end)
	let endOffset = windowEnd(text, startOffset, Math.max(1, rowBudget - 2), Math.max(1, width - 4))
	if (initialFence) endOffset = Math.min(endOffset, initialFence.after)
	const closingEnd = fences.find(fence => fence.end <= endOffset && endOffset < fence.after)
	if (closingEnd) endOffset = closingEnd.after
	const finalFence = fences.find(fence => fence.body <= endOffset && endOffset <= fence.end && fence.start < endOffset)
	let markdown = text.slice(startOffset, endOffset)
	if (initialFence) markdown = `${initialFence.opener}\n${markdown}`
	if (finalFence) markdown += `${markdown.endsWith('\n') ? '' : '\n'}${finalFence.closer}`
	const partialLine = startOffset > 0 && text[startOffset - 1] !== '\n' || endOffset < text.length && text[endOffset - 1] !== '\n'
	const context: RangeContext = initialFence
		? { kind: 'fence', prefix: text.slice(initialFence.body, startOffset), language: initialFence.opener.trimStart().replace(/^(`{3,}|~{3,})/, '').trim(), partialLine }
		: { kind: 'none' }
	return { markdown, startOffset, endOffset, needsContext: startOffset > 0 || partialLine, context }
}

export function syntaxSourceRange(text: string, window: MarkdownSourceWindow, code: string, language: string | undefined): { prefix: string; suffix: string } | undefined {
	for (const fence of sourceFences(text)) {
		const fenceLanguage = fence.opener.trimStart().replace(/^(`{3,}|~{3,})/, '').trim()
		if (fenceLanguage !== (language ?? '')) continue
		const start = Math.max(fence.body, window.startOffset)
		const end = Math.min(fence.end, window.endOffset)
		if (start >= end) continue
		const indent = /^ */.exec(fence.opener)?.[0].length ?? 0
		const normalize = (value: string) => replaceTabs(value).replace(new RegExp(`^ {0,${indent}}`, 'gm'), '')
		const visible = normalize(text.slice(start, end))
		if (visible.replace(/\n$/, '') !== code) continue
		const nextNewline = text.indexOf('\n', end)
		const lineEnd = end > 0 && text[end - 1] === '\n' ? end : Math.min(fence.end, nextNewline < 0 ? text.length : nextNewline + 1)
		return {
			prefix: normalize(text.slice(fence.body, start)),
			suffix: visible.slice(code.length) + replaceTabs(text.slice(end, lineEnd))
		}
	}
	return undefined
}

export function rangeMarkdownTheme(_text: string, _window: MarkdownSourceWindow, theme: MarkdownTheme): MarkdownTheme {
	return {
		...theme,
		highlightCode: code => code.split('\n').map(line => theme.codeBlock(line)),
		createHighlightStream: () => null
	}
}
