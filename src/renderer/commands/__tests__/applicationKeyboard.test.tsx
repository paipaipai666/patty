import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../shared/defaultSettings'
import { useSessionStore } from '../../store/sessionStore'
import { useWorkspaceStore } from '../../store/workspaceStore'
import { createShortcutCommands } from '../applicationCommands'
import { focusActiveTerminal, useApplicationKeyboard, useCommandExecution } from '../useApplicationKeyboard'

vi.mock('../../store/dirtyScheduler', () => ({ markDirty: vi.fn() }))

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
const created = vi.fn()

function Harness({ blocked = false, shortcut = 'Ctrl+T', unavailable = false }: { blocked?: boolean; shortcut?: string; unavailable?: boolean }) {
  const execute = useCommandExecution()
  const commands = createShortcutCommands({ ...DEFAULT_SETTINGS.shortcuts, newTerminal: shortcut }, {
    commandPalette: () => {},
    newTerminal: created, closeTerminal: () => {}, nextTab: () => useSessionStore.getState().navigateNext(),
    prevTab: () => useSessionStore.getState().navigatePrev(), toggleSidebar: () => {}, settings: () => {},
    splitHorizontal: () => {}, splitVertical: () => {}, closePane: () => {}
  })
  if (unavailable) commands[0].disabledReason = () => 'Navigation unavailable'
  useApplicationKeyboard({ commands, blocked, execute, navigateToIndex: index => useSessionStore.getState().navigateToIndex(index) })
  return <><div className="xterm" data-pane-id="pane-a"><textarea className="xterm-helper-textarea" /></div><div className="xterm" data-pane-id="pane-b"><textarea className="xterm-helper-textarea" /></div><input aria-label="Search" /><button>Trigger</button></>
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  created.mockClear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useSessionStore.setState({ sessions: [
    { id: 'a', title: 'A', shell: 'powershell', cwd: 'C:\\a', pid: 0, color: 'blue', collectionId: null, createdAt: 1 },
    { id: 'b', title: 'B', shell: 'powershell', cwd: 'C:\\b', pid: 0, color: 'blue', collectionId: null, createdAt: 2 }
  ], activeSessionId: 'a', agentStates: {} })
  useWorkspaceStore.getState().loadFromPersisted([
    { id: 'wa', name: 'A', collectionId: null, focusedPaneId: 'pane-a', paneTree: { id: 'pane-a', type: 'leaf', sessionId: 'a' } },
    { id: 'wb', name: 'B', collectionId: null, focusedPaneId: 'pane-b', paneTree: { id: 'pane-b', type: 'leaf', sessionId: 'b' } }
  ], 'wa')
  act(() => root.render(<Harness />))
})
afterEach(() => { act(() => root.unmount()); container.remove(); document.querySelector('[role="dialog"]')?.remove() })

function element<T extends HTMLElement>(selector: string): T {
  const found = container.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}
async function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...options })
  await act(async () => { document.activeElement?.dispatchEvent(event) })
  return event
}

describe('application keyboard', () => {
  it('handles a registered shortcut before xterm can write it and ignores held-key repeats', async () => {
    const input = element<HTMLTextAreaElement>('textarea')
    input.focus()
    const terminal = vi.fn()
    input.addEventListener('keydown', terminal)
    expect((await press('t')).defaultPrevented).toBe(true)
    await press('t', { repeat: true })
    expect(created).toHaveBeenCalledOnce()
    expect(terminal).not.toHaveBeenCalled()
  })

  it('preserves shell control keys, clipboard keys and modified numeric input', async () => {
    element('textarea').focus()
    for (const [key, options] of [['c', {}], ['v', {}], ['c', { shiftKey: true }], ['3', { altKey: true }]] satisfies [string, KeyboardEventInit][]) {
      expect((await press(key, options)).defaultPrevented).toBe(false)
    }
    expect(created).not.toHaveBeenCalled()
    expect(useSessionStore.getState().activeSessionId).toBe('a')
  })

  it('does not run workspace actions in editable fields or during composition', async () => {
    element('input').focus()
    await press('t')
    element('textarea').focus()
    await press('t', { isComposing: true })
    await press('t', { keyCode: 229 })
    act(() => element('textarea').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await press('t')
    act(() => element('textarea').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    expect(created).not.toHaveBeenCalled()
    await press('t')
    expect(created).toHaveBeenCalledOnce()
  })

  it('keeps application shortcuts out of dialogs even when background focus moves', async () => {
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    document.body.appendChild(dialog)
    element('textarea').focus()
    await press('t')
    dialog.remove()
    act(() => root.render(<Harness blocked />))
    await press('t')
    expect(created).not.toHaveBeenCalled()
  })

  it('switches both session and workspace and places the caret in the target terminal', async () => {
    element('textarea').focus()
    await press(']')
    expect(useSessionStore.getState().activeSessionId).toBe('b')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('wb')
    expect(document.activeElement).toBe(element('[data-pane-id="pane-b"] textarea'))
    await press('1')
    expect(useSessionStore.getState().activeSessionId).toBe('a')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('wa')
    expect(document.activeElement).toBe(element('[data-pane-id="pane-a"] textarea'))
  })

  it('updates remapped keys without leaving the former listener behind', async () => {
    element('textarea').focus()
    act(() => root.render(<Harness shortcut="Shift+Ctrl+Y" />))
    await press('t')
    expect(created).not.toHaveBeenCalled()
    await press('Y', { shiftKey: true })
    expect(created).toHaveBeenCalledOnce()
  })

  it('preserves terminal input when the matching application command is unavailable', async () => {
    act(() => root.render(<Harness unavailable />))
    element('textarea').focus()
    const terminal = vi.fn()
    element('textarea').addEventListener('keydown', terminal)
    expect((await press('t')).defaultPrevented).toBe(false)
    expect(terminal).toHaveBeenCalledOnce()
    expect(created).not.toHaveBeenCalled()
  })

  it('focuses the new-terminal action when the last layout pane is gone', () => {
    useWorkspaceStore.setState({ workspaces: [], activeWorkspaceId: null })
    const entry = document.createElement('button')
    entry.dataset.terminalEntry = ''
    entry.textContent = 'New terminal'
    container.appendChild(entry)
    expect(focusActiveTerminal()).toBe(true)
    expect(document.activeElement).toBe(entry)
  })

  it('preserves reserved terminal keys even if a legacy setting assigned them to an action', async () => {
    element('textarea').focus()
    act(() => root.render(<Harness shortcut="Ctrl+C" />))
    expect((await press('c')).defaultPrevented).toBe(false)
    expect(created).not.toHaveBeenCalled()
    act(() => root.render(<Harness shortcut="Ctrl+2" />))
    await press('2')
    expect(useSessionStore.getState().activeSessionId).toBe('b')
    expect(created).not.toHaveBeenCalled()
  })
})
