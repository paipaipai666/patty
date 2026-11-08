import { parentPort } from 'node:worker_threads'
import { HighlightStream, supportsLanguage } from '@oh-my-pi/pi-natives'
import { sliceByColumn, visibleWidth } from '@oh-my-pi/pi-tui/utils'
import type { HighlightReply, HighlightRequest } from './progressive-highlight'

if (!parentPort) throw new Error('Highlight worker requires a parent')
const port = parentPort

port.on('message', (request: HighlightRequest) => {
	port.postMessage({ kind: 'started', id: request.id } satisfies HighlightReply)
	let reply: HighlightReply
	try {
		if (!supportsLanguage(request.language)) throw new Error('Unsupported syntax language')
		const stream = new HighlightStream(request.language, request.colors)
		const completeEnd = request.prefix.lastIndexOf('\n') + 1
		let offset = 0
		while (offset < completeEnd) {
			const budgetEnd = Math.min(completeEnd, offset + 8192)
			let end = request.prefix.lastIndexOf('\n', budgetEnd - 1) + 1
			if (end <= offset) end = request.prefix.indexOf('\n', offset) + 1
			stream.push(request.prefix.slice(offset, end))
			offset = end
		}
		const partialPrefix = request.prefix.slice(completeEnd)
		const highlighted = stream.push(partialPrefix + request.code + request.suffix).split('\n')
		const codeLines = request.code.split('\n')
		const lines = codeLines.map((line, index) => {
			const rendered = highlighted[index] ?? ''
			const start = index === 0 ? visibleWidth(partialPrefix) : 0
			return sliceByColumn(rendered, start, visibleWidth(line))
		})
		reply = { kind: 'complete', id: request.id, lines }
	} catch {
		reply = { kind: 'failed', id: request.id }
	}
	port.postMessage(reply)
})
