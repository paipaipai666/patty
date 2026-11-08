import type { MarkdownTheme } from '@oh-my-pi/pi-tui/components/markdown'
import { rangeMarkdownTheme, type MarkdownSourceWindow } from './markdown-range'

export interface ProgressiveHighlightOptions {
  key: { sessionId: string; viewId: string; entryId: string; partId: string; contentRevision: number }
  isCurrent: () => boolean
  requestRender: () => void
}

export function progressiveRangeTheme(source: string, window: MarkdownSourceWindow, originalTheme: MarkdownTheme): MarkdownTheme {
  return rangeMarkdownTheme(source, window, originalTheme)
}

export function disposeProgressiveHighlighting(): void {}
