import { expect, test } from 'bun:test'
import { TUI } from '@oh-my-pi/pi-tui/tui'
import { SessionManager } from '@oh-my-pi/pi-coding-agent/session/session-manager'
import { createStandardNavigation } from './standard-navigation'
import { FixtureTerminal } from './fixture-terminal'

test('standard navigation catalogs user turns, browses, returns live, and preserves the leaf', async () => {
  const manager = SessionManager.inMemory('D:/standard-navigation')
  const first = manager.appendMessage({ role: 'user', content: 'STANDARD_NAV_FIRST_QUESTION', timestamp: 1 })
  const second = manager.appendMessage({ role: 'user', content: 'STANDARD_NAV_SECOND_QUESTION', timestamp: 2 })
  const terminal = new FixtureTerminal()
  const ui = new TUI(terminal)
  ui.start()
  const controller = createStandardNavigation({ ui, sessionManager: manager, cwd: 'D:/standard-navigation' })
  const leaf = manager.getLeafId()
  try {
    const catalog = controller.getCatalog()
    expect(catalog.turns.map(turn => turn.entryId)).toEqual([first, second])
    expect(controller.getPosition()).toMatchObject({ mode: 'live' })

    await controller.seek({ entryId: first })
    expect(controller.getPosition()).toMatchObject({ mode: 'browsing', entryId: first })
    expect(manager.getLeafId()).toBe(leaf)

    await controller.returnToLive()
    expect(controller.getPosition()).toMatchObject({ mode: 'live' })
    expect(manager.getLeafId()).toBe(leaf)
  } finally {
    controller.dispose()
    ui.stop()
  }
})
