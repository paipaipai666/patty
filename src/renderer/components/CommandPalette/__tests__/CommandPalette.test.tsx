import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette } from '../CommandPalette'
import { useApplicationKeyboard, useCommandExecution } from '../../../commands/useApplicationKeyboard'
import type { AppCommand } from '../../../commands/applicationCommands'
import { useSessionStore } from '../../../store/sessionStore'
import { useWorkspaceStore } from '../../../store/workspaceStore'
import { useToastStore } from '../../../store/toastStore'
import { selectSession } from '../../../store/sessionLifecycle'
import { usePaletteCommands } from '../../../commands/usePaletteCommands'

vi.mock('../../../store/dirtyScheduler', () => ({ markDirty: vi.fn() }))

const commands: AppCommand[] = [
  { id: 'disabled', label: 'Split terminal', group: 'Actions', description: 'Current pane', disabledReason: () => 'Select a terminal first', run: () => { throw new Error('Disabled action ran') } },
  { id: 'beta', label: 'Switch to Beta', group: 'Sessions', description: 'PowerShell · D:\\projects\\api', keywords: '切换 会话', run: () => { selectSession('b'); return 'terminal' } },
  { id: 'alpha', label: 'Switch to Alpha', group: 'Sessions', description: 'PowerShell · D:\\projects\\web', keywords: '切换 会话', run: () => { selectSession('a'); return 'terminal' } }
]
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement

function Harness({ options = commands }: { options?: AppCommand[] }) {
  const [open, setOpen] = useState(false)
  const execute = useCommandExecution()
  useApplicationKeyboard({
    commands: [{ id: 'open', label: 'Open command palette', group: 'Actions', description: 'Application', shortcut: 'Ctrl+Shift+P', allowInEditable: true, run: () => { setOpen(true); return 'dialog' } }],
    blocked: open, navigateToIndex: () => {}, execute
  })
  return <><button onClick={() => setOpen(true)}>Open commands</button><input aria-label="Session search" />
    <div data-pane-id="pa"><textarea className="xterm-helper-textarea" onFocus={() => selectSession('a')} /></div>
    <div data-pane-id="pb"><textarea className="xterm-helper-textarea" onFocus={() => selectSession('b')} /></div>
    {open && <CommandPalette commands={options} shortcut="Ctrl+Shift+P" onClose={() => setOpen(false)} onExecute={execute} />}</>
}

function ProgramHarness() {
  const options = usePaletteCommands([], async () => undefined)
  return <Harness options={options} />
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useToastStore.setState({ toasts: [] })
  useSessionStore.setState({ sessions: [
    { id: 'a', title: 'Alpha', shell: 'powershell', cwd: '', pid: 0, color: 'blue', collectionId: null, createdAt: 1 },
    { id: 'b', title: 'Beta', shell: 'powershell', cwd: '', pid: 0, color: 'blue', collectionId: null, createdAt: 2 }
  ], activeSessionId: 'a', agentStates: {}, programStates: {}, programRevisionFloor: 0 })
  useWorkspaceStore.getState().loadFromPersisted([
    { id: 'wa', name: 'Alpha', collectionId: null, focusedPaneId: 'pa', paneTree: { id: 'pa', type: 'leaf', sessionId: 'a' } },
    { id: 'wb', name: 'Beta', collectionId: null, focusedPaneId: 'pb', paneTree: { id: 'pb', type: 'leaf', sessionId: 'b' } }
  ], 'wa')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<Harness />))
})
afterEach(() => { act(() => root.unmount()); container.remove() })

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}
async function key(key: string, options: KeyboardEventInit = {}) {
  await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })))
}
function open() {
  const trigger = element<HTMLButtonElement>('button')
  trigger.focus()
  act(() => trigger.click())
  return trigger
}
function search(value: string) {
  const input = element<HTMLInputElement>('[role="combobox"]')
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setValue) throw new Error('Missing native input setter')
  act(() => { setValue.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

describe('command palette interaction', () => {
  it('navigates to a blocked ordinary program with the keyboard and acknowledges its report', async () => {
    act(() => {
      useSessionStore.getState().applyProgramBatch({ revision: 3, programs: [{ paneId: 'b', revision: 3, runId: '1', recordCount: 1, program: { id: '', revision: 1, state: 'blocked', kind: 'auth' } }] })
      root.render(<ProgramHarness />)
    })
    element<HTMLInputElement>('[aria-label="Session search"]').focus()
    await key('P', { ctrlKey: true, shiftKey: true })
    search('Next session needing attention')
    expect(element('[role="option"]').getAttribute('aria-disabled')).not.toBe('true')
    await key('Enter')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('wb')
    expect(document.activeElement).toBe(element('[data-pane-id="pb"] textarea'))
    expect(useSessionStore.getState().programStates.b?.activity).toEqual({ status: 'waiting_input', unread: false })
    expect(useSessionStore.getState().sessions[1].aiType).toBeUndefined()
  })
  it('focuses the search input and links its active option to a real enabled result', () => {
    open()
    const input = element<HTMLInputElement>('[role="combobox"]')
    expect(document.activeElement).toBe(input)
    expect(element('[role="dialog"]').getAttribute('aria-modal')).toBe('true')
    expect(element('[role="option"][aria-selected="true"]').textContent).toContain('Switch to Beta')
    expect(document.getElementById(input.getAttribute('aria-activedescendant') ?? '')?.textContent).toContain('Switch to Beta')
    expect(element('[role="status"]').textContent).toBe('3 results')
  })

  it('opens from an editable field with the configured shortcut and restores that field on Escape', async () => {
    const origin = element<HTMLInputElement>('[aria-label="Session search"]')
    origin.focus()
    await key('P', { ctrlKey: true, shiftKey: true })
    expect(document.activeElement?.getAttribute('role')).toBe('combobox')
    await key('Escape')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(origin)
  })

  it('wraps between enabled options and executes into the selected workspace and terminal', async () => {
    open()
    await key('ArrowUp')
    expect(element('[aria-selected="true"]').textContent).toContain('Switch to Alpha')
    await key('ArrowDown')
    expect(element('[aria-selected="true"]').textContent).toContain('Switch to Beta')
    await key('Enter')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(useSessionStore.getState().activeSessionId).toBe('b')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('wb')
    expect(document.activeElement).toBe(element('[data-pane-id="pb"] textarea'))
  })

  it('searches across words, Unicode and Windows path separators without marking sessions read', async () => {
    open()
    search('切换 D:/projects/api')
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
    expect(element('[role="option"]').textContent).toContain('Switch to Beta')
    expect(useSessionStore.getState().activeSessionId).toBe('a')
    await key('Escape')
  })

  it('keeps empty and disabled results non-executable', async () => {
    open()
    search('does not exist')
    expect(element('[role="status"]').textContent).toBe('0 results')
    expect(element('[role="combobox"]').hasAttribute('aria-activedescendant')).toBe(false)
    await key('Enter')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    search('split')
    expect(element('[role="option"]').getAttribute('aria-disabled')).toBe('true')
    act(() => element('[role="option"]').click())
    await key('Enter')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(useSessionStore.getState().activeSessionId).toBe('a')
  })

  it('keeps Tab and programmatic focus inside the palette and restores the trigger on cancellation', async () => {
    const trigger = open()
    await key('Tab')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close command palette')
    await key('Tab', { shiftKey: true })
    expect(document.activeElement?.getAttribute('role')).toBe('combobox')
    act(() => trigger.focus())
    expect(document.activeElement?.getAttribute('role')).toBe('combobox')
    act(() => element<HTMLButtonElement>('[aria-label="Close command palette"]').click())
    expect(document.activeElement).toBe(trigger)
  })

  it('does not execute, navigate or close while an input method is composing', async () => {
    open()
    const input = element('[role="combobox"]')
    act(() => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
    await key('ArrowDown')
    await key('Enter')
    await key('Escape')
    expect(element('[aria-selected="true"]').textContent).toContain('Switch to Beta')
    act(() => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
    await key('Enter', { keyCode: 229 })
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(useSessionStore.getState().activeSessionId).toBe('a')
    await key('Escape')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('ignores held confirmation and allows the palette shortcut to toggle closed', async () => {
    const trigger = open()
    await key('Enter', { repeat: true })
    expect(useSessionStore.getState().activeSessionId).toBe('a')
    await key('P', { ctrlKey: true, shiftKey: true })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('updates a disappearing result and resets the query on the next open', async () => {
    open()
    search('Switch')
    await key('ArrowDown')
    act(() => root.render(<Harness options={[commands[1]]} />))
    expect(element('[aria-selected="true"]').textContent).toContain('Switch to Beta')
    await key('Escape')
    open()
    expect(element<HTMLInputElement>('[role="combobox"]').value).toBe('')
  })

  it('shows an execution error and returns focus without changing the selected session', async () => {
    act(() => root.render(<Harness options={[{ id: 'failure', label: 'Save theme', group: 'Themes', description: 'Application', run: async () => { throw new Error('disk unavailable') } }]} />))
    const trigger = open()
    await key('Enter')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(useSessionStore.getState().activeSessionId).toBe('a')
    expect(useToastStore.getState().toasts.map(toast => toast.message)).toEqual(['Could not save theme. Try again.'])
  })

  it('does not refocus an old terminal and change the command target before execution', async () => {
    const current: AppCommand = { id: 'color', label: 'Color current session', group: 'Actions', description: 'Current session', run: () => {
      const state = useSessionStore.getState()
      if (state.activeSessionId) state.setColor(state.activeSessionId, 'amber')
      return 'terminal'
    } }
    act(() => root.render(<Harness options={[current]} />))
    act(() => element('[data-pane-id="pa"] textarea').focus())
    await key('P', { ctrlKey: true, shiftKey: true })
    act(() => selectSession('b'))
    await key('Enter')
    expect(useSessionStore.getState().sessions.map(session => [session.id, session.color])).toEqual([['a', 'blue'], ['b', 'amber']])
    expect(document.activeElement).toBe(element('[data-pane-id="pb"] textarea'))
  })
})
