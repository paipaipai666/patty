import { expect, test } from 'bun:test'
import { SessionManager } from '@oh-my-pi/pi-coding-agent/session/session-manager'
import { TUI } from '@oh-my-pi/pi-tui/tui'
import { CanonicalBranchIndex } from './canonical-renderer'
import { TranscriptNavigationController } from './native-navigation'
import { FixtureTerminal } from './fixture-terminal'

test('a warm seek in a 10k-turn session reads no branch snapshot or old source', async () => {
  const manager = SessionManager.inMemory('D:/navigation-performance')
  let first = ''
  for (let index = 0; index < 10000; index++) {
    const id = manager.appendMessage({ role: 'user', content: index === 0 ? 'PERF_FIRST_QUESTION' : `Question ${index}`, timestamp: index + 1 })
    if (index === 0) first = id
  }
  const index = new CanonicalBranchIndex()
  const terminal = new FixtureTerminal()
  const ui = new TUI(terminal)
  let snapshots = 0
  const controller = new TranscriptNavigationController({
    ui, sessionId: () => manager.getSessionId(), revision: () => `${manager.getSessionId()}:${manager.getLeafId()}`,
    branchIdentity: () => manager.getBranchView(), entries: () => { snapshots++; return index.read(manager.getBranchView()) }, resumeLive: () => {},
  })
  ui.start()
  try {
    expect(controller.getCatalog().turns.length).toBe(10000)
    const before = snapshots
    const started = performance.now()
    for (let seek = 0; seek < 20; seek++) {
      await controller.seek({ entryId: first })
      expect(controller.getPosition()).toMatchObject({ mode: 'browsing', entryId: first })
      await controller.returnToLive()
    }
    const elapsedMs = performance.now() - started
    expect(snapshots).toBe(before)
    expect(elapsedMs).toBeLessThan(2000)
    const existing = index.read(manager.getBranchView())[0]
    manager.appendMessage({ role: 'user', content: 'INCREMENTAL_APPEND', timestamp: 10001 })
    expect(controller.getCatalog().turns.at(-1)?.summary).toBe('INCREMENTAL_APPEND')
    expect(index.read(manager.getBranchView())[0]).toBe(existing)
    process.stderr.write(JSON.stringify({ benchmark: '10k-turn-warm-seek', seeks: 20, elapsedMs, snapshotsDuringWarmSeeks: snapshots - before - 1 }) + '\n')
  } finally { controller.dispose(); ui.stop() }
})
