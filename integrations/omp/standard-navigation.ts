import type { SessionEntry } from '@oh-my-pi/pi-coding-agent/session/session-entries'
import type { TUI } from '@oh-my-pi/pi-tui/tui'
import { CanonicalBranchIndex } from './canonical-renderer'
import { TranscriptNavigationController } from './native-navigation'
import { progressiveRangeTheme } from './progressive-highlight-lite'

export type StandardTui = TUI

export interface StandardSessionManager {
  getSessionId(): string
  getLeafId(): string | null
  getBranchView(): readonly SessionEntry[]
}

export interface StandardNavigationOptions {
  ui: StandardTui
  sessionManager: StandardSessionManager
  cwd: string
  subscribe?(listener: () => void): () => void
}

export type StandardNavigation = TranscriptNavigationController

export function createStandardNavigation(options: StandardNavigationOptions): StandardNavigation {
  const { ui, sessionManager, cwd, subscribe } = options
  const index = new CanonicalBranchIndex()
  return new TranscriptNavigationController({
    ui,
    entries: () => index.read(sessionManager.getBranchView(), { cwd, rangeTheme: progressiveRangeTheme }),
    sessionId: () => sessionManager.getSessionId(),
    branchIdentity: () => sessionManager.getBranchView(),
    revision: () => `${sessionManager.getSessionId()}:${sessionManager.getLeafId() ?? ''}`,
    resumeLive: () => { ui.requestRender(true) },
    ...(subscribe ? { subscribe } : {}),
  })
}
