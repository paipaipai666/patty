import type { SessionEntry } from '@oh-my-pi/pi-coding-agent/session/session-entries'
import { ChatTranscriptBuilder, type ChatTranscriptBuilderDeps } from '@oh-my-pi/pi-tui/chat/chat-transcript-builder'
import { textContent, isUserRequestEntry, type TranscriptEntryLike } from '@oh-my-pi/pi-tui/chat/transcript-entry'
import { Container, type Component, type TUI } from '@oh-my-pi/pi-tui/tui'
import { Markdown, type MarkdownTheme } from '@oh-my-pi/pi-tui/components/markdown'
import { getMarkdownTheme } from '@oh-my-pi/pi-tui/theme'
import type { MarkdownSourceWindow } from './markdown-range'
import { progressiveRangeTheme, type ProgressiveHighlightOptions } from './progressive-highlight'

export interface NavigationPart {
  readonly id: string
  readonly source: string
  render(window: MarkdownSourceWindow, ui: TUI, context?: ProgressiveHighlightOptions): Component
}

export interface NavigationEntry {
  readonly id: string
  readonly role: 'user' | 'assistant' | 'custom'
  readonly timestamp: number
  readonly synthetic: boolean
  readonly userInitiated: boolean
  readonly parts: readonly NavigationPart[]
}

export type RangeTheme = (source: string, window: MarkdownSourceWindow, theme: MarkdownTheme, options: ProgressiveHighlightOptions) => MarkdownTheme

type CanonicalDependencies = Omit<ChatTranscriptBuilderDeps, 'ui' | 'requestRender'> & { rangeTheme?: RangeTheme }

export class CanonicalBranchIndex {
  #branch: readonly SessionEntry[] | undefined
  #processed = 0
  #lastId = ''
  #entries: NavigationEntry[] = []
  #positions = new Map<string, number>()
  #owners = new Map<string, Extract<SessionEntry, { type: 'message' }>>()
  #results = new Map<string, Extract<SessionEntry, { type: 'message' }>>()

  read(branch: readonly SessionEntry[], dependencies?: CanonicalDependencies): readonly NavigationEntry[] {
    if (branch !== this.#branch || branch.length < this.#processed || (this.#processed > 0 && branch[this.#processed - 1]?.id !== this.#lastId)) {
      this.#branch = branch
      this.#processed = 0
      this.#entries = []
      this.#positions.clear()
      this.#owners.clear()
      this.#results.clear()
    }
    for (let index = this.#processed; index < branch.length; index++) {
      const entry = branch[index]
      if (!entry) continue
      if (entry.type === 'message' && entry.message.role === 'assistant') {
        for (const block of entry.message.content) if (block.type === 'toolCall') this.#owners.set(block.id, entry)
      }
      if (entry.type === 'message' && entry.message.role === 'toolResult') {
        this.#results.set(entry.message.toolCallId, entry)
        const owner = this.#owners.get(entry.message.toolCallId)
        if (owner?.message.role === 'assistant') {
          const related: SessionEntry[] = [owner]
          for (const block of owner.message.content) {
            if (block.type !== 'toolCall') continue
            const result = this.#results.get(block.id)
            if (result) related.push(result)
          }
          const updated = entriesFromBranch(related, dependencies)[0]
          const position = this.#positions.get(owner.id)
          if (updated && position !== undefined) this.#entries[position] = updated
        }
      } else {
        for (const visible of entriesFromBranch([entry], dependencies)) {
          this.#positions.set(visible.id, this.#entries.length)
          this.#entries.push(visible)
        }
      }
    }
    this.#processed = branch.length
    this.#lastId = branch.at(-1)?.id ?? ''
    return this.#entries
  }
}

function canonical(entries: TranscriptEntryLike[], ui: TUI, range: { source: string; window: MarkdownSourceWindow; context?: ProgressiveHighlightOptions } | undefined, dependencies: CanonicalDependencies): Component {
  const { rangeTheme, ...builderDeps } = dependencies
  const builder = new ChatTranscriptBuilder({ ...builderDeps, ui, requestRender: () => ui.requestRender() })
  builder.rebuild(entries)
  if (range) {
    const theme = rangeTheme ?? progressiveRangeTheme
    const renderTheme = theme(range.source, range.window, getMarkdownTheme(), range.context ?? {
      key: { sessionId: 'standalone', viewId: 'standalone', entryId: entries[0]?.id ?? '', partId: 'content', contentRevision: 0 },
      isCurrent: () => true, requestRender: () => ui.requestRender(),
    })
    const update = (component: Component): void => {
      if (component instanceof Markdown) {
        const themed: { setRenderTheme?(theme: MarkdownTheme): void; setSourceMapping?(enabled: boolean): void } = component
        themed.setRenderTheme?.(renderTheme)
        themed.setSourceMapping?.(true)
      }
      if (component instanceof Container) for (const child of component.children) update(child)
    }
    update(builder.container)
  }
  return builder.container
}

export function entriesFromBranch(branch: readonly SessionEntry[], dependencies: CanonicalDependencies = { cwd: process.cwd(), expandThinkingBlocks: () => true }): NavigationEntry[] {
  const build = (entries: TranscriptEntryLike[], ui: TUI, range?: { source: string; window: MarkdownSourceWindow; context?: ProgressiveHighlightOptions }): Component => canonical(entries, ui, range, dependencies)
  const entries: NavigationEntry[] = []
  const results = new Map<string, Extract<SessionEntry, { type: 'message' }>>()
  for (const entry of branch) if (entry.type === 'message' && entry.message.role === 'toolResult') results.set(entry.message.toolCallId, entry)
  for (const entry of branch) {
    if (entry.type === 'custom_message') {
      if (!entry.display) continue
      entries.push({
        id: entry.id, role: 'custom', timestamp: Date.parse(entry.timestamp), synthetic: false, userInitiated: isUserRequestEntry(entry),
        parts: [{ id: `${entry.id}:content`, source: textContent(entry.content), render: (window, ui, context) => build([{ ...entry, content: window.markdown }], ui, { source: textContent(entry.content), window, context }) }],
      })
      continue
    }
    if (entry.type !== 'message') continue
    const message = entry.message
    if (message.role === 'user') {
      const source = textContent(message.content)
      entries.push({
        id: entry.id, role: 'user', timestamp: message.timestamp, synthetic: message.synthetic ?? false, userInitiated: message.synthetic !== true,
        parts: [{
          id: `${entry.id}:user`, source: source || '[Attachment]',
          render(window, ui, context) {
            const images = typeof message.content === 'string' ? [] : message.content.filter(block => block.type === 'image')
            return build([{ ...entry, message: { ...message, content: [{ type: 'text', text: window.markdown }, ...images] } }], ui, { source, window, context })
          },
        }],
      })
    } else if (message.role === 'assistant') {
      const parts: NavigationPart[] = []
      for (const [index, block] of message.content.entries()) {
        const id = `${entry.id}:${index}`
        if (block.type === 'text') {
          parts.push({ id, source: block.text, render: (window, ui, context) => build([{ ...entry, message: { ...message, content: [{ ...block, text: window.markdown }] } }], ui, { source: block.text, window, context }) })
        } else if (block.type === 'thinking') {
          parts.push({ id, source: block.thinking, render: (window, ui, context) => build([{ ...entry, message: { ...message, content: [{ ...block, thinking: window.markdown }] } }], ui, { source: block.thinking, window, context }) })
        } else if (block.type === 'toolCall') {
          const result = results.get(block.id)
          const response = result?.message
          const source = response?.role === 'toolResult' ? textContent(response.content) : JSON.stringify(block.arguments)
          parts.push({
            id, source,
            render(window, ui, context) {
              const call: TranscriptEntryLike = { ...entry, message: { ...message, content: [block] } }
              if (!result || response?.role !== 'toolResult') return build([call], ui)
              const images = response.content.filter(content => content.type === 'image')
              return build([call, { ...result, message: { ...response, content: [{ type: 'text', text: window.markdown }, ...images] } }], ui, { source, window, context })
            },
          })
        } else if (block.type === 'image') {
          parts.push({ id, source: '[Image]', render: (_window, ui) => build([{ ...entry, message: { ...message, content: [block] } }], ui) })
        }
      }
      if (parts.length) entries.push({ id: entry.id, role: 'assistant', timestamp: message.timestamp, synthetic: false, userInitiated: false, parts })
    }
  }
  return entries
}
