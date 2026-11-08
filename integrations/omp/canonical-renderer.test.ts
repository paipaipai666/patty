import { expect, test } from 'bun:test'
import { SessionManager } from '@oh-my-pi/pi-coding-agent/session/session-manager'
import { TUI, Container } from '@oh-my-pi/pi-tui/tui'
import { stripTerminalSequences } from '@oh-my-pi/pi-tui/utils'
import { CanonicalBranchIndex, entriesFromBranch } from './canonical-renderer'
import { sourceWindow } from './markdown-range'
import { FixtureTerminal } from './fixture-terminal'

test('assistant prose, thinking and tool results keep their canonical message components', () => {
  const manager = SessionManager.inMemory('D:/gate0-fixture')
  manager.appendMessage({ role: 'user', content: 'Inspect this', timestamp: 1 })
  manager.appendMessage({
    role: 'assistant', timestamp: 2, api: 'anthropic-messages', provider: 'anthropic', model: 'fixture', stopReason: 'toolUse',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    content: [{ type: 'thinking', thinking: 'Thinking source preserved' }, { type: 'text', text: 'Reply source preserved' }, { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'echo result' } }],
  })
  manager.appendMessage({ role: 'toolResult', timestamp: 3, toolCallId: 'call-1', toolName: 'bash', content: [{ type: 'text', text: 'TOOL_RESULT_PRESERVED' }], isError: false })
  const ui = new TUI(new FixtureTerminal())
  const entries = entriesFromBranch(manager.getBranch())
  const assistant = entries.find(entry => entry.role === 'assistant')
  expect(assistant?.parts.map(part => part.source)).toEqual(['Thinking source preserved', 'Reply source preserved', 'TOOL_RESULT_PRESERVED'])
  const names = assistant?.parts.map(part => {
    const component = part.render(sourceWindow(part.source, 0, 20, 80), ui)
    expect(component).toBeInstanceOf(Container)
    return component instanceof Container ? component.children.map(child => child.constructor.name) : []
  })
  expect(names?.[0]).toContain('AssistantMessageComponent')
  expect(names?.[1]).toContain('AssistantMessageComponent')
  expect(names?.[2]).toContain('ToolExecutionComponent')
  const tool = assistant?.parts[2]
  expect(tool?.render(sourceWindow(tool.source, 0, 20, 80), ui).render(80).map(stripTerminalSequences).join('\n')).toContain('TOOL_RESULT_PRESERVED')
})

test('incremental tool results preserve earlier call results and stable user parts', () => {
  const manager = SessionManager.inMemory('D:/canonical-index')
  manager.appendMessage({ role: 'user', content: 'Run both commands', timestamp: 1 })
  manager.appendMessage({
    role: 'assistant', timestamp: 2, api: 'anthropic-messages', provider: 'anthropic', model: 'fixture', stopReason: 'toolUse',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    content: [{ type: 'toolCall', id: 'first', name: 'bash', arguments: { command: 'echo one' } }, { type: 'toolCall', id: 'second', name: 'bash', arguments: { command: 'echo two' } }],
  })
  const index = new CanonicalBranchIndex()
  const before = index.read(manager.getBranchView())[0]
  manager.appendMessage({ role: 'toolResult', timestamp: 3, toolCallId: 'first', toolName: 'bash', content: [{ type: 'text', text: 'FIRST_RESULT' }], isError: false })
  index.read(manager.getBranchView())
  manager.appendMessage({ role: 'toolResult', timestamp: 4, toolCallId: 'second', toolName: 'bash', content: [{ type: 'text', text: 'SECOND_RESULT' }], isError: false })
  const entries = index.read(manager.getBranchView())
  expect(entries[0]).toBe(before)
  const assistant = entries[1]
  expect(assistant?.parts.map(part => part.source)).toEqual(['FIRST_RESULT', 'SECOND_RESULT'])
  const ui = new TUI(new FixtureTerminal())
  const painted = assistant?.parts.map(part => part.render(sourceWindow(part.source, 0, 20, 80), ui).render(80).map(stripTerminalSequences).join('\n')).join('\n')
  expect(painted).toContain('FIRST_RESULT')
  expect(painted).toContain('SECOND_RESULT')
})

test('a large assistant code part reaches its canonical renderer through a source window', () => {
  const manager = SessionManager.inMemory('D:/gate0-fixture')
  manager.appendMessage({
    role: 'assistant', timestamp: 2, api: 'anthropic-messages', provider: 'anthropic', model: 'fixture', stopReason: 'stop',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    content: [{ type: 'text', text: '```typescript\nconst visible = 1\n' + 'const hidden = 2\n'.repeat(20_000) + '```' }],
  })
  const part = entriesFromBranch(manager.getBranch())[0]?.parts[0]
  expect(part).toBeDefined()
  if (!part) throw new Error('missing assistant part')
  const window = sourceWindow(part.source, 0, 8, 80)
  expect(window.markdown.length).toBeLessThan(600)
  const component = part.render(window, new TUI(new FixtureTerminal()))
  const rows = component.render(80)
  expect(rows.map(stripTerminalSequences).join('\n')).toContain('const visible = 1')
  expect(rows.length).toBeLessThan(20)
})
