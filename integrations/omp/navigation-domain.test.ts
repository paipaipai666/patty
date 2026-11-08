import { expect, test } from 'bun:test'
import { TUI, Container, type Component } from '@oh-my-pi/pi-tui/tui'
import { SessionManager } from '@oh-my-pi/pi-coding-agent/session/session-manager'
import { TranscriptNavigationController, entriesFromBranch } from './native-navigation'
import { FixtureTerminal } from './fixture-terminal'
import { scalarToCodeUnit, codeUnitToScalar } from './navigation-api'

function setup() {
  const terminal = new FixtureTerminal()
  const ui = new TUI(terminal)
  const manager = SessionManager.inMemory('D:/navigation-domain')
  const first = manager.appendMessage({ role: 'user', content: '😀 first question', timestamp: 10 })
  const received: string[] = []
  const editor: Component = { render: () => ['editor'], handleInput: data => { received.push(data) } }
  ui.addChild(new Container())
  ui.setFocus(editor)
  const controller = new TranscriptNavigationController({
    ui, entries: () => entriesFromBranch(manager.getBranch()), sessionId: () => manager.getSessionId(),
    branchIds: () => manager.getBranch().map(entry => entry.id), resumeLive: () => ui.requestRender(true),
  })
  ui.start()
  return { terminal, ui, manager, first, received, editor, controller }
}

test('publishes a durable turn catalog and Unicode scalar source anchors', async () => {
  const f = setup()
  try {
    expect(f.controller.getCapabilities()).toEqual({ transcriptNavigation: 1, catalogSnapshot: 1, nativeHistoryViewport: 1, frameObservation: 1 })
    expect(f.controller.getCatalog().turns).toEqual([{ entryId: f.first, summary: '😀 first question', timestamp: 10 }])
    const positions: string[] = []
    f.controller.onPosition(position => positions.push(position.mode))
    const position = await f.controller.seek({ entryId: f.first, anchor: { partId: `${f.first}:user`, scalarOffset: 2 } })
    expect(position).toMatchObject({ mode: 'browsing', entryId: f.first, anchor: { partId: `${f.first}:user`, scalarOffset: 2 } })
    expect(scalarToCodeUnit('😀 first', 2)).toBe(3)
    expect(codeUnitToScalar('😀 first', 3)).toBe(2)
    expect(positions).toContain('browsing')
    expect(f.terminal.output).toContain('\x1b]777;patty-nav-v1;')
    expect(position.frameId.length).toBeGreaterThan(0)
  } finally { f.controller.dispose(); f.ui.stop() }
})

test('keeps the branch epoch for append and advances it for actual path changes', async () => {
  const f = setup()
  try {
    const catalogs: number[] = []
    f.controller.onCatalog(catalog => catalogs.push(catalog.turns.length))
    const before = f.controller.getCatalog()
    await f.controller.seek({ entryId: f.first })
    f.manager.appendMessage({ role: 'user', content: 'appended', timestamp: 20 })
    expect(f.controller.getCatalog().branchEpoch).toBe(before.branchEpoch)
    expect(f.controller.getPosition().mode).toBe('browsing')
    expect(catalogs).toContain(2)
    f.manager.branch(f.first)
    f.manager.appendMessage({ role: 'user', content: 'forked', timestamp: 30 })
    expect(f.controller.getCatalog().branchEpoch).toBe(before.branchEpoch + 1)
    expect(f.controller.getPosition().mode).toBe('live')
    await expect(f.controller.seek({ entryId: f.first, expectedBranchEpoch: before.branchEpoch })).rejects.toThrow('stale_branch')
  } finally { f.controller.dispose(); f.ui.stop() }
})

test('local committed input invalidates remote seeks and reaches the original editor exactly once', async () => {
  const f = setup()
  try {
    await f.controller.seek({ entryId: f.first })
    const old = f.controller.getPosition()
    f.terminal.input('你好')
    expect(f.received).toEqual(['你好'])
    await expect(f.controller.seek({ entryId: f.first, expectedDisplayEpoch: old.displayEpoch })).rejects.toThrow('stale_display')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.controller.getPosition().mode).toBe('live')
    expect(f.received).toEqual(['你好'])
    expect(f.ui.getFocused()).toBe(f.editor)
    await f.controller.seek({ entryId: f.first })
    f.terminal.input('\x1b[200~')
    f.terminal.input('paste 😀')
    f.terminal.input('\x1b[201~')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.received).toEqual(['你好', '\x1b[200~', 'paste 😀', '\x1b[201~'])
  } finally { f.controller.dispose(); f.ui.stop() }
})

test('an asynchronous live restore queues committed text across a modal without redirecting or losing it', async () => {
  const terminal = new FixtureTerminal()
  const ui = new TUI(terminal)
  const manager = SessionManager.inMemory('D:/input-transaction')
  const first = manager.appendMessage({ role: 'user', content: 'question', timestamp: 1 })
  const received: string[] = []
  const editor: Component = { render: () => ['editor'], handleInput: data => { received.push(data) } }
  ui.setFocus(editor)
  let finishRestore: (() => void) | undefined
  const restoring = new Promise<void>(resolve => { finishRestore = resolve })
  const controller = new TranscriptNavigationController({ ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => restoring })
  ui.start()
  try {
    await controller.seek({ entryId: first })
    terminal.input('queued text')
    const resumeModal = controller.suspendForModal()
    const modalInput: string[] = []
    ui.setFocus({ render: () => ['modal'], handleInput: data => { modalInput.push(data) } })
    finishRestore?.()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(received).toEqual([])
    expect(modalInput).toEqual([])
    ui.setFocus(editor)
    resumeModal()
    expect(received).toEqual(['queued text'])
    expect(modalInput).toEqual([])
  } finally { controller.dispose(); ui.stop() }
})

test('modal suspension preserves focus ownership and resumes a valid historical anchor', async () => {
  const f = setup()
  try {
    await f.controller.seek({ entryId: f.first })
    const resume = f.controller.suspendForModal()
    const modalInput: string[] = []
    const modal: Component = { render: () => ['approval'], handleInput: data => { modalInput.push(data) } }
    f.ui.setFocus(modal)
    f.terminal.input('y')
    expect(modalInput).toEqual(['y'])
    expect(f.received).toEqual([])
    await expect(f.controller.seek({ entryId: f.first })).rejects.toThrow('busy')
    await expect(f.controller.returnToLive()).rejects.toThrow('busy')
    f.ui.setFocus(f.editor)
    resume()
    expect(f.controller.getPosition()).toMatchObject({ mode: 'browsing', entryId: f.first })
    await f.controller.returnToLive()
    const before = f.controller.getPosition()
    const after = await f.controller.returnToLive()
    expect(after.frameId.length).toBeGreaterThan(0)
    expect(after.viewRevision).toBeGreaterThan(before.viewRevision)
    expect(after.frameId).not.toBe(before.frameId)
  } finally { f.controller.dispose(); f.ui.stop() }
})

test('interrupt and disposal never replay committed input twice or accept a later seek', async () => {
  const f = setup()
  try {
    await f.controller.seek({ entryId: f.first })
    f.terminal.input('\x03')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.received).toEqual(['\x03'])
    await f.controller.seek({ entryId: f.first })
    f.terminal.input('stale')
    f.controller.dispose()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(f.received).toEqual(['\x03', 'stale'])
    await expect(f.controller.seek({ entryId: f.first })).rejects.toThrow('navigation_disposed')
  } finally { f.controller.dispose(); f.ui.stop() }
})

test('nested modal ownership resumes the original browsing anchor only after the last modal closes', async () => {
  const f = setup()
  try {
    await f.controller.seek({ entryId: f.first })
    const outer = f.controller.suspendForModal()
    const inner = f.controller.suspendForModal()
    inner()
    expect(f.controller.getPosition().mode).toBe('live')
    outer()
    expect(f.controller.getPosition()).toMatchObject({ mode: 'browsing', entryId: f.first })
  } finally { f.controller.dispose(); f.ui.stop() }
})

test('another native overlay owns the screen and keyboard until it closes', async () => {
  const f = setup()
  try {
    await f.controller.seek({ entryId: f.first })
    const historyFrame = f.controller.getPosition().frameId
    const keys: string[] = []
    const modal = f.ui.showOverlay({ render: () => ['native picker'], handleInput: data => { keys.push(data) } }, { width: '100%', maxHeight: '100%' })
    f.ui.renderNow()
    expect(f.controller.getPosition().frameId).toBe(historyFrame)
    f.terminal.input('x')
    expect(keys).toEqual(['x'])
    expect(f.received).toEqual([])
    await expect(f.controller.seek({ entryId: f.first })).rejects.toThrow('busy')
    await expect(f.controller.returnToLive()).rejects.toThrow('busy')
    modal.hide()
    await f.controller.seek({ entryId: f.first })
    expect(f.controller.getPosition().frameId).not.toBe(historyFrame)
  } finally { f.controller.dispose(); f.ui.stop() }
})

test('a rebuilt branch memo with the same prefix is still a background append', async () => {
  const manager = SessionManager.inMemory('D:/branch-memo')
  const first = manager.appendMessage({ role: 'user', content: 'original question', timestamp: 1 })
  const ui = new TUI(new FixtureTerminal())
  const controller = new TranscriptNavigationController({
    ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => {},
    sessionId: () => manager.getSessionId(), revision: () => `${manager.getSessionId()}:${manager.getLeafId()}`,
    branchIdentity: () => manager.getBranch(),
  })
  ui.start()
  try {
    await controller.seek({ entryId: first })
    const before = controller.getPosition()
    manager.appendMessage({ role: 'user', content: 'background append', timestamp: 2 })
    expect(controller.getPosition()).toMatchObject({ mode: 'browsing', branchEpoch: before.branchEpoch, entryId: first })
  } finally { controller.dispose(); ui.stop() }
})
