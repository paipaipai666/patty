import { expect, test } from 'bun:test'
import { TUI, Container } from '@oh-my-pi/pi-tui/tui'
import { Markdown } from '@oh-my-pi/pi-tui/components/markdown'
import { getMarkdownTheme } from '@oh-my-pi/pi-tui/theme'
import { SessionManager } from '@oh-my-pi/pi-coding-agent/session/session-manager'
import { stripTerminalSequences } from '@oh-my-pi/pi-tui/utils'
import { TranscriptNavigationController, entriesFromBranch } from './native-navigation'
import { rangeMarkdownTheme, sourceWindow } from './markdown-range'
import { FixtureTerminal } from './fixture-terminal'

test('seeks a durable user entry without changing the session leaf or rendering previous messages', async () => {
  const manager = SessionManager.inMemory('D:/gate0-fixture')
  const first = manager.appendMessage({ role: 'user', content: 'OMP_NAV_QUESTION_000', timestamp: 1 })
  for (let index = 1; index < 1200; index++) {
    manager.appendMessage({ role: 'user', content: `Question ${index}`, timestamp: index + 1 })
  }
  const terminal = new FixtureTerminal()
  const ui = new TUI(terminal)
  ui.addChild(new Container())
  ui.start()
  const leaf = manager.getLeafId()
  const controller = new TranscriptNavigationController({
    ui,
    entries: () => entriesFromBranch(manager.getBranch()),
    resumeLive: () => {},
  })
  try {
    await controller.seek({ entryId: first })
    expect(controller.getPosition()).toMatchObject({ mode: 'browsing', entryId: first })
    const painted = controller.viewport.render(100).map(stripTerminalSequences).join('\n')
    expect(painted).toContain('OMP_NAV_QUESTION_000')
    expect(manager.getLeafId()).toBe(leaf)
    expect(controller.viewport.metrics.renderedEntries).toBeLessThan(30)
    expect(terminal.output).toContain('\x1b[?1049h')
    await controller.returnToLive()
    expect(controller.getPosition()).toMatchObject({ mode: 'live' })
    expect(terminal.output).toContain('\x1b[?1049l')
  } finally {
    ui.stop()
  }
})

test('keeps the history anchor during background appends and resumes live exactly once', async () => {
  const terminal = new FixtureTerminal()
  const ui = new TUI(terminal)
  const manager = SessionManager.inMemory('D:/gate0-fixture')
  const first = manager.appendMessage({ role: 'user', content: 'first', timestamp: 1 })
  let resumed = 0
  const controller = new TranscriptNavigationController({ ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => { resumed++ } })
  ui.start()
  try {
    await controller.seek({ entryId: first })
    manager.appendMessage({ role: 'user', content: 'background addition', timestamp: 2 })
    ui.renderNow()
    expect(controller.getPosition()).toMatchObject({ mode: 'browsing', entryId: first })
    await controller.returnToLive()
    await controller.returnToLive()
    expect(resumed).toBe(1)
  } finally {
    ui.stop()
  }
})

test('scrolling down and back up preserves a source anchor inside a long message', () => {
  const manager = SessionManager.inMemory('D:/gate0-fixture')
  const source = Array.from({ length: 300 }, (_, index) => `line ${index}`).join('\n')
  const id = manager.appendMessage({ role: 'user', content: source, timestamp: 1 })
  const ui = new TUI(new FixtureTerminal())
  const controller = new TranscriptNavigationController({ ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => {} })
  controller.viewport.seek(id, source.indexOf('line 50\n'))
  controller.viewport.render(100)
  const before = controller.viewport.getPosition()
  controller.viewport.scroll(1)
  controller.viewport.render(100)
  controller.viewport.scroll(-1)
  expect(controller.viewport.getPosition()).toEqual(before)
})

test('page scroll retains every step when it crosses a source window boundary', () => {
  const manager = SessionManager.inMemory('D:/gate0-fixture')
  const id = manager.appendMessage({ role: 'user', content: Array.from({ length: 300 }, (_, index) => `line ${index}`).join('\n'), timestamp: 1 })
  const ui = new TUI(new FixtureTerminal())
  const host = { ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => {} }
  const page = new TranscriptNavigationController(host).viewport
  const individual = new TranscriptNavigationController(host).viewport
  page.seek(id)
  individual.seek(id)
  page.render(100)
  page.scroll(70)
  for (let count = 0; count < 70; count++) { individual.render(100); individual.scroll(1) }
  expect(page.getPosition()).toEqual(individual.getPosition())
})

test('source anchors survive actual Markdown list reflow, modal ownership and a round trip to another width', async () => {
  const manager = SessionManager.inMemory('D:/source-anchor')
  const source = '- first **bold words** and 中文字符 end\n- next item\n- last item with 😀 emoji'
  const entryId = manager.appendMessage({ role: 'user', content: source, timestamp: 1 })
  const terminal = new FixtureTerminal()
  terminal.columns = 18
  const ui = new TUI(terminal)
  const controller = new TranscriptNavigationController({ ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => {} })
  ui.start()
  try {
    await controller.seek({ entryId })
    controller.viewport.scroll(1)
    const before = controller.getPosition()
    expect(before).toMatchObject({ mode: 'browsing', anchor: { scalarOffset: 15 } })
    const topBefore = stripTerminalSequences(controller.viewport.render(18)[1] ?? '').trim()
    expect(topBefore).toBe('words and 中文')
    const resume = controller.suspendForModal()
    resume()
    expect(stripTerminalSequences(controller.viewport.render(18)[1] ?? '').trim()).toBe('words and 中文')
    terminal.columns = 31
    controller.viewport.render(31)
    const wider = controller.getPosition()
    expect(wider).toMatchObject({ mode: 'browsing', anchor: { scalarOffset: 15 } })
    terminal.columns = 18
    controller.viewport.render(18)
    expect(stripTerminalSequences(controller.viewport.render(18)[1] ?? '').trim()).toBe('words and 中文')
    expect(controller.getPosition()).toMatchObject({ mode: 'browsing', anchor: { scalarOffset: 15 } })
  } finally { controller.dispose(); ui.stop() }
})

test('a restored Unicode anchor selects the original code row without leaking internal source markers', async () => {
  const manager = SessionManager.inMemory('D:/source-anchor')
  const source = '```ts\nconst 中文 = "😀 abcdefghijklmnopqrstuvwxyz";\nreturn 中文;\n```'
  const entryId = manager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: source }], api: 'openai-completions', provider: 'openai', model: 'fixture', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop', timestamp: 1 })
  const terminal = new FixtureTerminal()
  terminal.columns = 24
  const ui = new TUI(terminal)
  const controller = new TranscriptNavigationController({ ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => {} })
  ui.start()
  try {
    const scalarOffset = Array.from(source.slice(0, source.indexOf('return'))).length
    await controller.seek({ entryId, anchor: { partId: `${entryId}:0`, scalarOffset } })
    expect(stripTerminalSequences(controller.viewport.render(24)[1] ?? '').trim()).toBe('return 中文;')
    expect(controller.getPosition()).toMatchObject({ mode: 'browsing', anchor: { scalarOffset } })
    expect(terminal.output).not.toContain('omp-source;')
  } finally { controller.dispose(); ui.stop() }
})

test('scrolling up from a cold middle seek visits the preceding source line', () => {
  const manager = SessionManager.inMemory('D:/source-anchor')
  const source = Array.from({ length: 1000 }, (_, index) => `line ${String(index).padStart(4, '0')}`).join('\n')
  const id = manager.appendMessage({ role: 'user', content: source, timestamp: 1 })
  const ui = new TUI(new FixtureTerminal())
  const controller = new TranscriptNavigationController({ ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => {} })
  controller.viewport.seek(id, source.indexOf('line 0500'))
  controller.viewport.render(100)
  controller.viewport.scroll(-1)
  const text = controller.viewport.render(100).map(stripTerminalSequences).join('\n')
  expect(text).toContain('line 0499')
  expect(text.indexOf('line 0499')).toBeLessThan(text.indexOf('line 0500'))
  controller.dispose()
})

test('narrowing the terminal keeps a distant top source point visible beyond the new window budget', async () => {
  const manager = SessionManager.inMemory('D:/source-anchor')
  const source = Array.from({ length: 300 }, (_, index) => `position ${String(index).padStart(4, '0')}`).join('\n')
  const entryId = manager.appendMessage({ role: 'user', content: source, timestamp: 1 })
  const terminal = new FixtureTerminal()
  const ui = new TUI(terminal)
  const controller = new TranscriptNavigationController({ ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => {} })
  ui.start()
  try {
    await controller.seek({ entryId })
    controller.viewport.scroll(40)
    expect(stripTerminalSequences(controller.viewport.render(100)[1] ?? '').trim()).toBe('position 0040')
    const before = controller.getPosition()
    terminal.columns = 16
    const narrowed = controller.viewport.render(16).map(stripTerminalSequences)
    expect((narrowed[1] ?? '').trim()).toBe('position 0040')
    expect(controller.getPosition()).toMatchObject(before.mode === 'browsing' ? { mode: 'browsing', anchor: before.anchor } : { mode: 'browsing' })
  } finally { controller.dispose(); ui.stop() }
})

test('renders a long unmarked component instead of trimming its window to zero rows', () => {
  const source = Array.from({ length: 300 }, (_, index) => `unmarked line ${String(index).padStart(3, '0')}`).join('\n')
  const entry = {
    id: 'unmarked-entry', role: 'user' as const, timestamp: 1, synthetic: false, userInitiated: true,
    parts: [{
      id: 'unmarked-entry:user', source,
      render: (window: ReturnType<typeof sourceWindow>) => new Markdown(window.markdown, 1, 0, rangeMarkdownTheme(source, window, getMarkdownTheme())),
    }],
  }
  const ui = new TUI(new FixtureTerminal())
  const controller = new TranscriptNavigationController({ ui, entries: () => [entry], resumeLive: () => {} })
  controller.viewport.seek('unmarked-entry', source.indexOf('unmarked line 060'))
  const rendered = controller.viewport.render(100).map(stripTerminalSequences).join('\n')
  expect(rendered).toContain('unmarked line 060')
  expect(controller.viewport.metrics.renderedEntries).toBeGreaterThan(0)
  controller.dispose()
})

test('scrolling down past the end of the last turn returns to live', async () => {
  const manager = SessionManager.inMemory('D:/gate0-fixture')
  const entryId = manager.appendMessage({ role: 'user', content: 'hello', timestamp: 1 })
  const terminal = new FixtureTerminal()
  const ui = new TUI(terminal)
  ui.addChild(new Container())
  ui.start()
  let resumed = 0
  const controller = new TranscriptNavigationController({ ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => { resumed++ } })
  try {
    await controller.seek({ entryId })
    expect(controller.getPosition()).toMatchObject({ mode: 'browsing', entryId })
    ui.injectDebugInput('\x1b[B')
    await Promise.resolve()
    expect(controller.getPosition().mode).toBe('live')
    expect(resumed).toBe(1)
  } finally {
    controller.dispose()
    ui.stop()
  }
})

test('scrolling down inside a long final part without reaching its end stays browsing', async () => {
  const manager = SessionManager.inMemory('D:/gate0-fixture')
  const source = Array.from({ length: 300 }, (_, index) => `line ${index}`).join('\n')
  const entryId = manager.appendMessage({ role: 'user', content: source, timestamp: 1 })
  const terminal = new FixtureTerminal()
  const ui = new TUI(terminal)
  ui.addChild(new Container())
  ui.start()
  let resumed = 0
  const controller = new TranscriptNavigationController({ ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => { resumed++ } })
  try {
    await controller.seek({ entryId })
    expect(controller.getPosition()).toMatchObject({ mode: 'browsing', entryId })
    ui.injectDebugInput('\x1b[B')
    await Promise.resolve()
    expect(controller.getPosition()).toMatchObject({ mode: 'browsing', entryId })
    expect(resumed).toBe(0)
  } finally {
    controller.dispose()
    ui.stop()
  }
})

test('scrolling down past a trailing custom message returns to live', async () => {
  const manager = SessionManager.inMemory('D:/gate0-fixture')
  const entryId = manager.appendMessage({ role: 'user', content: 'latest question', timestamp: 1 })
  manager.appendCustomMessageEntry('patty-navigation-fixture', 'OMP_NAV_GENERATED_WHILE_BROWSING', true, undefined, 'agent', 2)
  const terminal = new FixtureTerminal()
  const ui = new TUI(terminal)
  ui.addChild(new Container())
  ui.start()
  let resumed = 0
  const controller = new TranscriptNavigationController({ ui, entries: () => entriesFromBranch(manager.getBranch()), resumeLive: () => { resumed++ } })
  try {
    await controller.seek({ entryId })
    for (let index = 0; index < 8; index++) {
      ui.injectDebugInput('\x1b[B')
      await Promise.resolve()
    }
    expect(controller.getPosition().mode).toBe('live')
    expect(resumed).toBe(1)
  } finally {
    controller.dispose()
    ui.stop()
  }
})
