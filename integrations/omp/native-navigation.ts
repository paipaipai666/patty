import { theme } from '@oh-my-pi/pi-tui/theme'
import { Container, type Component, type OverlayHandle, type TUI } from '@oh-my-pi/pi-tui/tui'
import { sourceWindow } from './markdown-range'
import type { NavigationEntry } from './canonical-renderer'
import { codeUnitToScalar, scalarToCodeUnit, type DisplayGuard, type SeekTarget, type TranscriptCapabilities, type TranscriptNavigationApi, type TranscriptPosition, type TurnCatalog } from './navigation-api'
import { disposeProgressiveHighlighting, type ProgressiveHighlightOptions } from './progressive-highlight'
import { sourceRows, type SourceRow } from './markdown-source-map'
export { entriesFromBranch } from './canonical-renderer'

export type NavigationPosition = { mode: 'live' } | {
  mode: 'browsing'
  entryId: string
  sourceOffset: number
  rowOffset: number
  partIndex: number
  endLimit?: number
}

interface NavigationHost {
  ui: TUI
  entries(): readonly NavigationEntry[]
  resumeLive(): void | Promise<void>
  sessionId?(): string
  branchIds?(): readonly string[]
  revision?(): string
  branchIdentity?(): readonly { readonly id: string }[]
  indexOf?(entryId: string): number
  subscribe?(listener: () => void): () => void
  renderContext?(entryId: string, partId: string, source: string): ProgressiveHighlightOptions
}

function turnPreview(entry: NavigationEntry): string {
  const scalars: string[] = []
  let space = false
  let scanned = 0
  for (const part of entry.parts) {
    for (const scalar of part.source) {
      if (++scanned > 640) return scalars.join('')
      if (/\s/u.test(scalar)) { space = scalars.length > 0; continue }
      if (space && scalars.length < 160) scalars.push(' ')
      if (scalars.length >= 160) return scalars.join('')
      scalars.push(scalar)
      space = false
    }
    space = scalars.length > 0
  }
  return scalars.join('')
}

export class TranscriptViewport implements Component {
  #anchor: Omit<Extract<NavigationPosition, { mode: 'browsing' }>, 'mode'> = { entryId: '', sourceOffset: 0, rowOffset: 0, partIndex: 0 }
  #trail: Array<Omit<Extract<NavigationPosition, { mode: 'browsing' }>, 'mode'>> = []
  #currentRows: readonly string[] = []
  #endOffset = 0
  #rowSources: readonly SourceRow[] = []
  #renderWidth = 0
  #renderHeight = 0
  #pendingSource: number | undefined
  #logicalPoint: number | undefined
  metrics = { renderedEntries: 0, sourceUnits: 0, needsContext: false }

  constructor(private readonly host: NavigationHost, private readonly changed: () => void = () => {}) {}

  seek(entryId: string, sourceOffset = 0, partIndex = 0): void {
    const entries = this.host.entries()
    const entry = entries[this.host.indexOf?.(entryId) ?? entries.findIndex(entry => entry.id === entryId)]
    if (!entry) throw new Error('entry_not_found')
    const part = entry.parts[partIndex]
    if (!part) throw new Error('part_not_found')
    const point = Math.min(part.source.length, Math.max(0, Math.trunc(sourceOffset)))
    const separator = part.source.lastIndexOf('\n\n', Math.max(0, point - 1))
    const paragraph = separator < 0 ? 0 : separator + 2
    const line = part.source.lastIndexOf('\n', Math.max(0, point - 1)) + 1
    const budget = this.host.ui.terminal.columns * Math.max(1, this.host.ui.terminal.rows - 4)
    const start = point - Math.max(0, paragraph) <= budget ? Math.max(0, paragraph) : point - line <= budget ? line : point
    this.#anchor = { entryId, sourceOffset: start, rowOffset: 0, partIndex }
    this.#pendingSource = point
    this.#logicalPoint = point
    this.#trail = []
    this.#rowSources = []
  }

  getPosition(): NavigationPosition {
    return { mode: 'browsing', ...this.#anchor }
  }

  getSourcePosition(): NavigationPosition {
    const row = this.#sourceRow()
    const point = this.#logicalPoint ?? row?.start ?? this.#anchor.sourceOffset
    return { mode: 'browsing', ...this.#anchor, sourceOffset: point }
  }

  scroll(rows: number): boolean {
    this.#logicalPoint = undefined
    const entries = this.host.entries()
    let remaining = Math.trunc(rows)
    while (remaining !== 0) {
      this.render(this.host.ui.terminal.columns)
      const current = this.host.indexOf?.(this.#anchor.entryId) ?? entries.findIndex(entry => entry.id === this.#anchor.entryId)
      const entry = entries[current]
      const part = entry?.parts[this.#anchor.partIndex]
      if (!entry || !part) break
      if (remaining > 0) {
        const available = Math.max(1, this.#currentRows.length - this.#anchor.rowOffset)
        if (remaining < available) { this.#anchor.rowOffset += remaining; break }
        remaining -= available
        const before = { ...this.#anchor, rowOffset: 0 }
        const nextEntry = entries[current + 1]
        if (this.#endOffset < part.source.length && this.#endOffset > this.#anchor.sourceOffset) {
          this.#anchor.sourceOffset = this.#endOffset
          this.#anchor.endLimit = undefined
        } else if (entry.parts[this.#anchor.partIndex + 1]) {
          this.#anchor.partIndex++
          this.#anchor.sourceOffset = 0
        } else if (nextEntry) {
          this.#anchor = { entryId: nextEntry.id, partIndex: 0, sourceOffset: 0, rowOffset: 0 }
        } else {
          this.#anchor.rowOffset = Math.max(0, this.#currentRows.length - 1)
          break
        }
        this.#trail.push(before)
        if (this.#trail.length > 128) this.#trail.shift()
        this.#anchor.rowOffset = 0
      } else {
        const distance = -remaining
        if (distance <= this.#anchor.rowOffset) { this.#anchor.rowOffset -= distance; break }
        remaining += this.#anchor.rowOffset
        const previous = this.#trail.pop()
        if (previous) this.#anchor = previous
        else if (this.#anchor.sourceOffset > 0) {
          this.#anchor.endLimit = this.#anchor.sourceOffset
          const limit = Math.max(0, this.#anchor.sourceOffset - this.host.ui.terminal.columns * Math.max(1, this.host.ui.terminal.rows - 4))
          const newline = part.source.indexOf('\n', limit)
          this.#anchor.sourceOffset = newline >= 0 && newline < this.#anchor.sourceOffset - 1 ? newline + 1 : limit
        } else {
          const previousPart = entry.parts[this.#anchor.partIndex - 1]
          const previousEntry = entries[current - 1]
          if (previousPart) this.#anchor.partIndex--
          else if (previousEntry) { this.#anchor.entryId = previousEntry.id; this.#anchor.partIndex = previousEntry.parts.length - 1 }
          else break
          const selected = entries[this.host.indexOf?.(this.#anchor.entryId) ?? entries.findIndex(candidate => candidate.id === this.#anchor.entryId)]?.parts[this.#anchor.partIndex]
          if (!selected) break
          this.#anchor.sourceOffset = Math.max(0, selected.source.length - this.host.ui.terminal.columns * Math.max(1, this.host.ui.terminal.rows - 4))
          this.#anchor.endLimit = selected.source.length
        }
        this.#anchor.rowOffset = 0
        this.render(this.host.ui.terminal.columns)
        while (this.#anchor.endLimit !== undefined && this.#endOffset < this.#anchor.endLimit && this.#endOffset > this.#anchor.sourceOffset) {
          this.#anchor.sourceOffset = this.#endOffset
          this.render(this.host.ui.terminal.columns)
        }
        this.#anchor.rowOffset = this.#currentRows.length
      }
    }
    this.render(this.host.ui.terminal.columns)
    this.#logicalPoint = this.#sourceRow()?.start ?? this.#anchor.sourceOffset
    this.host.ui.requestRender()
    this.changed()
    if (rows <= 0) return false
    const finalIndex = this.host.indexOf?.(this.#anchor.entryId) ?? entries.findIndex(entry => entry.id === this.#anchor.entryId)
    const finalEntry = entries[finalIndex]
    const finalPart = finalEntry?.parts[this.#anchor.partIndex]
    const atLastRow = this.#anchor.rowOffset >= Math.max(0, this.#currentRows.length - 1)
    return finalIndex === entries.length - 1
      && this.#anchor.partIndex === (finalEntry?.parts.length ?? 0) - 1
      && atLastRow
      && (finalPart?.source.length ?? 0) <= this.#endOffset
  }

  #sourceRow(): SourceRow | undefined {
    for (let index = this.#anchor.rowOffset; index < this.#rowSources.length; index++) {
      const row = this.#rowSources[index]
      if (row?.start !== undefined) return row
    }
    for (let index = this.#anchor.rowOffset - 1; index >= 0; index--) {
      const row = this.#rowSources[index]
      if (row?.start !== undefined) return row
    }
    return undefined
  }

  handleInput(data: string): boolean {
    if (data === '\x1b[A') { this.scroll(-1); return false }
    if (data === '\x1b[B') return this.scroll(1)
    if (data === '\x1b[5~') { this.scroll(-Math.max(1, this.host.ui.terminal.rows - 4)); return false }
    if (data === '\x1b[6~') return this.scroll(Math.max(1, this.host.ui.terminal.rows - 4))
    return false
  }

  render(width: number): readonly string[] {
    const height = Math.max(3, this.host.ui.terminal.rows)
    const resizing = this.#renderWidth !== 0 && (width !== this.#renderWidth || height !== this.#renderHeight)
    const beforeResize = resizing ? this.getSourcePosition() : undefined
    if (beforeResize?.mode === 'browsing') this.#pendingSource = beforeResize.sourceOffset
    this.#renderWidth = width
    this.#renderHeight = height
    const bodyHeight = height - 2
    const entries = this.host.entries()
    let index = this.host.indexOf?.(this.#anchor.entryId) ?? entries.findIndex(entry => entry.id === this.#anchor.entryId)
    this.metrics = { renderedEntries: 0, sourceUnits: 0, needsContext: false }
    const body: string[] = []
    let partIndex = this.#anchor.partIndex
    let continuation: number | undefined
    let initialWindow = true
    while (index >= 0 && index < entries.length && body.length < bodyHeight) {
      const entry = entries[index]
      if (!entry) break
      const first = entry.id === this.#anchor.entryId
      const part = entry.parts[partIndex]
      if (!part) { index++; partIndex = 0; continue }
      const firstPart = initialWindow && first && partIndex === this.#anchor.partIndex
      const offset = continuation ?? (firstPart ? this.#anchor.sourceOffset : 0)
      const limited = firstPart && this.#anchor.endLimit !== undefined ? part.source.slice(0, this.#anchor.endLimit) : part.source
      const window = sourceWindow(limited, offset, Math.max(4, bodyHeight * 2), Math.max(1, width - 4))
      if (firstPart && this.#pendingSource !== undefined && this.#pendingSource >= window.endOffset && this.#pendingSource < part.source.length) {
        const point = this.#pendingSource
        const line = part.source.lastIndexOf('\n', Math.max(0, point - 1)) + 1
        this.#anchor.sourceOffset = line > offset ? line : point
        this.#anchor.endLimit = undefined
        this.#anchor.rowOffset = 0
        return this.render(width)
      }
      this.metrics.renderedEntries++
      this.metrics.sourceUnits += window.markdown.length
      this.metrics.needsContext ||= window.needsContext
      const component = part.render(window, this.host.ui, this.host.renderContext?.(entry.id, part.id, part.source))
      const mapped = sourceRows(component.render(width), window.markdown)
      const prefix = window.context.kind === 'fence' ? window.markdown.indexOf('\n') + 1 : 0
      const convert = (point: number | undefined): number | undefined => point === undefined ? undefined : window.startOffset + Math.max(0, Math.min(window.endOffset - window.startOffset, point - prefix))
      let sources = mapped.map(row => ({ text: row.text, start: convert(row.start), end: convert(row.end) }))
      if (window.startOffset > 0) {
        const firstSource = sources.findIndex(row => row.start !== undefined)
        if (firstSource > 0) sources = sources.slice(firstSource)
      }
      if (window.endOffset < part.source.length && sources.some(row => row.start !== undefined)) {
        let lastSource = sources.length - 1
        while (lastSource >= 0 && sources[lastSource]?.start === undefined) lastSource--
        sources = sources.slice(0, lastSource + 1)
      }
      const rendered = sources.map(row => row.text)
      if (component instanceof Container) component.dispose()
      if (firstPart) {
        this.#currentRows = rendered
        this.#endOffset = window.endOffset
        this.#rowSources = sources
        if (this.#pendingSource !== undefined) {
          const point = this.#pendingSource
          let selected = sources.findIndex(row => row.start !== undefined && row.end !== undefined && row.start <= point && point <= row.end)
          if (selected < 0) selected = sources.findIndex(row => row.start !== undefined && row.start >= point)
          if (selected >= 0) this.#anchor.rowOffset = selected
          this.#pendingSource = undefined
        }
      }
      body.push(...rendered.slice(firstPart ? this.#anchor.rowOffset : 0, bodyHeight - body.length + (firstPart ? this.#anchor.rowOffset : 0)))
      initialWindow = false
      if (window.endOffset < part.source.length && window.endOffset > offset) { continuation = window.endOffset; continue }
      continuation = undefined
      partIndex++
      if (partIndex >= entry.parts.length) { index++; partIndex = 0 }
    }
    while (body.length < bodyHeight) body.push('')
    return [theme.fg('dim', 'Conversation history'), ...body, theme.fg('dim', 'Esc: return to live   Up/Down: scroll   PgUp/PgDn: page')]
  }
}

export class TranscriptNavigationController implements TranscriptNavigationApi {
  readonly viewport: TranscriptViewport
  #overlay: OverlayHandle | undefined
  #sessionId = ''
  #branchIds: readonly string[] = []
  #branchIdentity: readonly { readonly id: string }[] | undefined
  #revision: string | undefined
  #entries: readonly NavigationEntry[] = []
  #entryCount = 0
  #entryIndices = new Map<string, number>()
  #branchEpoch = 0
  #displayEpoch = 0
  #viewRevision = 0
  #frameSequence = 0
  #frameId = ''
  #viewScope = 0
  #contentVersions = new Map<string, { source: string; revision: number }>()
  #catalogRevision = 0
  #catalog: TurnCatalog = { sessionId: '', branchEpoch: 0, catalogRevision: 0, turns: [] }
  #positionListeners = new Set<(position: TranscriptPosition) => void>()
  #catalogListeners = new Set<(catalog: TurnCatalog) => void>()
  #unsubscribers: Array<() => void> = []
  #disposed = false
  #refreshing = false
  #modalDepth = 0
  #replay = false
  #inputPending = false
  #resumePending = false
  #operation = 0
  #pasteActive = false
  #queuedInput: Array<{ data: string; sessionId: string; branchEpoch: number }> = []

  constructor(private readonly host: NavigationHost) {
    this.viewport = new TranscriptViewport({ ...host, entries: () => this.#entries, indexOf: entryId => this.#entryIndices.get(entryId) ?? -1, renderContext: (entryId, partId, source) => this.#renderContext(entryId, partId, source) }, () => { this.#displayEpoch++; this.#viewScope++; this.#render() })
    this.refresh()
    this.#unsubscribers.push(host.ui.addPaintListener(() => {
      if (this.#disposed || !this.#ownsScreen()) return
      const before = this.#branchEpoch
      this.refresh()
      if (before !== this.#branchEpoch) { queueMicrotask(() => { if (!this.#disposed) this.#render() }); return }
      this.#publishFrame()
    }))
    this.#unsubscribers.push(host.ui.addInputListener(data => this.#onInput(data), { prepend: true }))
    if (host.subscribe) this.#unsubscribers.push(host.subscribe(() => {
      this.refresh()
      if (this.#overlay) host.ui.requestRender()
    }))
  }

  getCapabilities(): TranscriptCapabilities {
    return { transcriptNavigation: 1, catalogSnapshot: 1, nativeHistoryViewport: 1, frameObservation: 1 }
  }

  refresh(): void {
    if (this.#disposed || this.#refreshing) return
    const revision = this.host.revision?.()
    if (revision !== undefined && revision === this.#revision) return
    this.#refreshing = true
    try {
      const entries = this.host.entries()
      const sessionId = this.host.sessionId?.() ?? 'standalone'
      const identity = this.host.branchIdentity?.()
      const branch = identity !== undefined ? [] : this.host.branchIds?.() ?? entries.map(entry => entry.id)
      const pathChanged = identity !== undefined
        ? identity !== this.#branchIdentity && this.#branchIdentity?.some((entry, index) => identity[index]?.id !== entry.id) === true
        : this.#branchIds.some((id, index) => branch[index] !== id)
      const changed = this.#sessionId !== '' && (sessionId !== this.#sessionId || pathChanged)
      this.#revision = revision
      this.#branchIdentity = identity
      this.#sessionId = sessionId
      if (identity === undefined) this.#branchIds = [...branch]
      if (changed) {
        this.#branchEpoch++
        this.#displayEpoch++
        this.#operation++
        this.#queuedInput = []
        this.#contentVersions.clear()
        this.#hide()
        void this.host.resumeLive()
      }
      const from = changed ? 0 : this.#entryCount
      if (changed) this.#entryIndices.clear()
      const added: TurnCatalog['turns'][number][] = []
      for (let index = from; index < entries.length; index++) {
        const entry = entries[index]
        if (!entry) continue
        this.#entryIndices.set(entry.id, index)
        if (entry.userInitiated) added.push({ entryId: entry.id, summary: turnPreview(entry), timestamp: entry.timestamp })
      }
      this.#entries = entries
      this.#entryCount = entries.length
      if (changed || added.length > 0 || this.#catalogRevision === 0) {
        const turns = changed ? added : [...this.#catalog.turns, ...added]
        this.#catalog = { sessionId, branchEpoch: this.#branchEpoch, catalogRevision: ++this.#catalogRevision, turns }
        for (const listener of this.#catalogListeners) listener(this.#catalog)
      }
    } finally { this.#refreshing = false }
  }

  getCatalog(): TurnCatalog {
    this.refresh()
    return this.#catalog
  }

  onCatalog(listener: (catalog: TurnCatalog) => void): () => void {
    this.#catalogListeners.add(listener)
    return () => { this.#catalogListeners.delete(listener) }
  }

  onPosition(listener: (position: TranscriptPosition) => void): () => void {
    this.#positionListeners.add(listener)
    return () => { this.#positionListeners.delete(listener) }
  }

  async seek(target: SeekTarget): Promise<TranscriptPosition> {
    this.#assertActive()
    this.refresh()
    this.#guard(target)
    if (this.#inputPending || this.#pasteActive || this.#modalDepth || (this.#overlay ? this.host.ui.getFocused() !== this.viewport : this.host.ui.hasOverlay())) throw new Error('busy')
    const entry = this.#entries[this.#entryIndices.get(target.entryId) ?? -1]
    if (!entry) throw new Error('entry_not_found')
    const partIndex = target.anchor ? entry.parts.findIndex(part => part.id === target.anchor?.partId) : 0
    const part = entry.parts[partIndex]
    if (!part) throw new Error('part_not_found')
    const offset = target.anchor?.scalarOffset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('invalid_anchor')
    this.#operation++
    this.viewport.seek(target.entryId, scalarToCodeUnit(part.source, offset), partIndex)
    this.#viewScope++
    this.#overlay ??= this.host.ui.showOverlay(this.viewport, { fullscreen: false, mouseTracking: false, width: '100%', maxHeight: '100%', anchor: 'top-left', row: 0, col: 0 })
    this.#render()
    return this.getPosition()
  }

  getPosition(): TranscriptPosition {
    this.refresh()
    const identity = { sessionId: this.#sessionId, branchEpoch: this.#branchEpoch, displayEpoch: this.#displayEpoch, viewRevision: this.#viewRevision, frameId: this.#frameId }
    const position = this.viewport.getSourcePosition()
    if (!this.#overlay || position.mode !== 'browsing') return { ...identity, mode: 'live' }
    const part = this.#entries[this.#entryIndices.get(position.entryId) ?? -1]?.parts[position.partIndex]
    if (!part) return { ...identity, mode: 'live' }
    return { ...identity, mode: 'browsing', entryId: position.entryId, anchor: { partId: part.id, scalarOffset: codeUnitToScalar(part.source, position.sourceOffset) } }
  }

  async returnToLive(target: DisplayGuard = {}): Promise<TranscriptPosition> {
    if (this.#inputPending) throw new Error('busy')
    const restoring = this.#restoreLive(target)
    if (restoring) await restoring
    return this.getPosition()
  }

  #restoreLive(target: DisplayGuard): void | Promise<void> {
    this.#assertActive()
    this.refresh()
    this.#guard(target)
    if (!this.#ownsScreen()) throw new Error('busy')
    const operation = ++this.#operation
    const hadOverlay = !!this.#overlay
    this.#hide()
    const complete = (): void => {
      if (this.#disposed) return
      if (operation !== this.#operation) throw new Error('superseded')
      if (!this.#modalDepth) this.#render()
    }
    const restoring = hadOverlay ? this.host.resumeLive() : undefined
    if (restoring) return restoring.then(complete)
    complete()
  }

  suspendForModal(): () => void {
    this.#assertActive()
    const position = this.getPosition()
    this.#modalDepth++
    this.#displayEpoch++
    this.#hide()
    let resumed = false
    return () => {
      if (resumed || this.#disposed) return
      resumed = true
      this.#modalDepth--
      this.refresh()
      if (this.#modalDepth === 0 && position.mode === 'browsing' && position.sessionId === this.#sessionId && position.branchEpoch === this.#branchEpoch) {
        this.#viewScope++
        this.#overlay = this.host.ui.showOverlay(this.viewport, { fullscreen: false, mouseTracking: false, width: '100%', maxHeight: '100%', anchor: 'top-left', row: 0, col: 0 })
        this.#render()
      } else if (!this.#modalDepth) this.#render()
      if (!this.#modalDepth && !this.#resumePending && this.#inputPending) this.#drainInput()
    }
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#hide()
    this.#queuedInput = []
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe()
    this.#positionListeners.clear()
    this.#catalogListeners.clear()
    this.#contentVersions.clear()
    void disposeProgressiveHighlighting()
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('navigation_disposed')
  }

  #guard(target: DisplayGuard): void {
    if (target.expectedBranchEpoch !== undefined && target.expectedBranchEpoch !== this.#branchEpoch) throw new Error('stale_branch')
    if (target.expectedDisplayEpoch !== undefined && target.expectedDisplayEpoch !== this.#displayEpoch) throw new Error('stale_display')
  }

  #hide(): void {
    const overlay = this.#overlay
    this.#overlay = undefined
    this.#viewScope++
    overlay?.hide()
  }

  #render(): void {
    const before = this.#frameSequence
    this.host.ui.renderNow()
    if (before === this.#frameSequence && this.#ownsScreen()) this.#publishFrame()
  }

  #ownsScreen(): boolean {
    return this.#modalDepth === 0 && (!this.host.ui.hasOverlay() || (!!this.#overlay && this.host.ui.getFocused() === this.viewport))
  }

  #renderContext(entryId: string, partId: string, source: string): ProgressiveHighlightOptions {
    const previous = this.#contentVersions.get(partId)
    const contentRevision = previous?.source === source ? previous.revision : (previous?.revision ?? 0) + 1
    this.#contentVersions.set(partId, { source, revision: contentRevision })
    if (this.#contentVersions.size > 128) {
      const oldest = this.#contentVersions.keys().next()
      if (!oldest.done) this.#contentVersions.delete(oldest.value)
    }
    const sessionId = this.#sessionId
    const branchEpoch = this.#branchEpoch
    const scope = this.#viewScope
    return {
      key: { sessionId, viewId: `${branchEpoch}:${scope}`, entryId, partId, contentRevision },
      isCurrent: () => !this.#disposed && !!this.#overlay && !this.#modalDepth && sessionId === this.#sessionId && branchEpoch === this.#branchEpoch && scope === this.#viewScope && this.#contentVersions.get(partId)?.revision === contentRevision,
      requestRender: () => this.host.ui.requestRender(),
    }
  }

  #publishFrame(): void {
    this.#viewRevision++
    this.#frameId = `${this.#sessionId}:${++this.#frameSequence}`
    const position = this.getPosition()
    const payload = Buffer.from(JSON.stringify(position)).toString('base64url')
    this.host.ui.terminal.write(`\x1b]777;patty-nav-v1;${payload}\x07`)
    for (const listener of this.#positionListeners) listener(position)
  }

  #onInput(data: string): { consume: true } | undefined {
    if (this.#replay || this.#disposed) return
    this.refresh()
    this.#displayEpoch++
    if (data.includes('\x1b[200~')) this.#pasteActive = true
    if (data.includes('\x1b[201~')) this.#pasteActive = false
    if (this.#modalDepth) return
    if (this.#overlay && this.host.ui.getFocused() !== this.viewport) return
    if (this.#overlay && !this.#inputPending) {
      if (data === '\x1b') { void this.returnToLive(); return { consume: true } }
      if (['\x1b[A', '\x1b[B', '\x1b[5~', '\x1b[6~'].includes(data)) {
        if (this.viewport.handleInput(data)) void this.returnToLive()
        return { consume: true }
      }
    }
    if (!this.#overlay && !this.#inputPending) return
    this.#queuedInput.push({ data, sessionId: this.#sessionId, branchEpoch: this.#branchEpoch })
    if (!this.#inputPending) {
      this.#inputPending = true
      const restoring = this.#restoreLive({})
      if (restoring) {
        this.#resumePending = true
        const drain = (): void => { this.#resumePending = false; this.#drainInput() }
        void restoring.then(drain, drain)
      } else this.#drainInput()
    }
    return { consume: true }
  }

  #drainInput(): void {
    if (this.#modalDepth) return
    try {
      while (this.#queuedInput.length && !this.#disposed && !this.#modalDepth) {
        const queued = this.#queuedInput.shift()
        if (!queued) break
        this.refresh()
        if (queued.sessionId !== this.#sessionId || queued.branchEpoch !== this.#branchEpoch) continue
        this.#replay = true
        try { this.host.ui.injectDebugInput(queued.data) } finally { this.#replay = false }
      }
    } finally { this.#inputPending = this.#queuedInput.length > 0 && !this.#disposed }
  }
}
