import { TUI, Container } from '@oh-my-pi/pi-tui/tui'
import { Markdown } from '@oh-my-pi/pi-tui/components/markdown'
import { ChatTranscriptBuilder } from '@oh-my-pi/pi-tui/chat/chat-transcript-builder'
import { getMarkdownTheme } from '@oh-my-pi/pi-tui/theme'
import type { ExtensionContext } from '@oh-my-pi/pi-coding-agent/extensibility/extensions/types'
import { createStandardNavigation, type StandardNavigation, type StandardSessionManager } from './standard-navigation'

export function standardRuntimeModules(ui: TUI): Record<string, unknown> {
  return {
    hostIsImportedTui: ui instanceof TUI,
    hostIsImportedContainer: ui instanceof Container,
    markdownPrototype: Object.getOwnPropertyNames(Markdown.prototype),
    builderType: typeof ChatTranscriptBuilder,
    hostConstructor: ui.constructor.name,
    importedConstructor: TUI.name,
  }
}

export function standardRuntimeController(ui: TUI, ctx: ExtensionContext): StandardNavigation {
  const sessionManager = ctx.sessionManager as unknown as StandardSessionManager
  if (typeof sessionManager.getBranchView !== 'function') throw new Error('getBranchView_unavailable')
  return createStandardNavigation({ ui, sessionManager, cwd: ctx.cwd })
}
