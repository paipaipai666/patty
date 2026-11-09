import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnNavigation } from '../TurnNavigation'
import { useOmpNavigationStore, type PaneNavigationState } from '../../../store/ompNavigationStore'
import type { NavigationPosition } from '../../../../shared/ompNavigationTypes'
import { useWorkspaceStore } from '../../../store/workspaceStore'
import { useSessionStore } from '../../../store/sessionStore'
import { createTurnNavigationCommands } from '../../../commands/turnNavigationCommands'
import { useApplicationKeyboard, useCommandExecution } from '../../../commands/useApplicationKeyboard'

vi.mock('../../../store/dirtyScheduler', () => ({ markDirty: vi.fn() }))

let root: ReturnType<typeof createRoot>
let container: HTMLDivElement
const navigate = vi.fn(async () => {})
const relative = vi.fn(async () => {})
const returnLive = vi.fn(async () => {})
const close = vi.fn()

function KeyboardHarness({ blocked = false }: { blocked?: boolean }) {
	const execute = useCommandExecution()
	useApplicationKeyboard({
		commands: createTurnNavigationCommands({ turnDirectory: 'Ctrl+Shift+J', previousTurn: 'Ctrl+Shift+PageUp', nextTurn: 'Ctrl+Shift+PageDown', returnToLive: 'Ctrl+Shift+End' }, () => { close(true); return 'dialog' }),
		blocked, navigateToIndex: () => {}, execute
	})
	return <><div data-pane-id="focused-pane" className="xterm"><textarea className="xterm-helper-textarea" /></div><input aria-label="Other editable field" /></>
}

function ready(turnCount = 3): PaneNavigationState {
	const position: NavigationPosition = { mode: 'browsing', sessionId: 'conversation', branchEpoch: 1, displayEpoch: 1, viewRevision: 1, frameId: 'frame', entryId: 'entry-2', anchor: { partId: 'part', scalarOffset: 0 } }
	return {
		status: 'ready',
		snapshot: {
			kind: 'ready', paneId: 'focused-terminal', runId: 'run', instanceId: 'instance', sessionId: 'conversation', revision: 1,
			scope: { scopeId: 'scope', controlEpoch: 1 }, branchEpoch: 1, displayEpoch: 1, catalogRevision: 1,
			position, latestRequest: null, catalogSnapshotId: 'catalog', turnCount, pageSize: 256
		},
		turns: Array.from({ length: turnCount }, (_, index) => ({ entryId: `entry-${index + 1}`, ordinal: index + 1, preview: index === 1 ? '修复 中文 输入' : 'Repeated prompt', createdAt: 1_700_000_000_000 + index })),
		error: null, navigating: false, pendingTarget: null, shownPosition: position
	}
}

function element<T extends HTMLElement>(selector: string): T {
	const found = document.querySelector<T>(selector)
	if (!found) throw new Error(`Missing ${selector}`)
	return found
}

function search(value: string) {
	const input = element<HTMLInputElement>('[role="combobox"]')
	const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
	if (!setter) throw new Error('Missing input setter')
	act(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => {
	globalThis.IS_REACT_ACT_ENVIRONMENT = true
	vi.clearAllMocks()
	useWorkspaceStore.getState().loadFromPersisted([{ id: 'workspace', name: 'Workspace', collectionId: null, focusedPaneId: 'focused-pane', paneTree: { id: 'focused-pane', type: 'leaf', sessionId: 'focused-terminal' } }], 'workspace')
	useOmpNavigationStore.setState({ byPane: {}, start: vi.fn(async () => {}), stop: vi.fn(), navigate, relative, returnLive })
	container = document.createElement('div')
	document.body.appendChild(container)
	root = createRoot(container)
})

afterEach(() => { act(() => root.unmount()); container.remove() })

describe('current-terminal turn navigation', () => {
	it('shows only marks at rest and previews a hovered prompt without navigating or taking terminal focus', () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': ready(9) } })
		act(() => root.render(<><div data-pane-id="focused-pane"><textarea className="xterm-helper-textarea" /></div><TurnNavigation open={false} onOpenChange={close} blocked={false} /></>))
		const terminal = element<HTMLTextAreaElement>('textarea')
		terminal.focus()
		expect(document.querySelector('[role="toolbar"]')).toBeNull()
		expect(element('[data-turn-rail]').dataset.expanded).toBe('false')
		expect(document.querySelector('[aria-label="Conversation turn preview"]')).toBeNull()
		const target = element('[data-entry-id="entry-5"]')
		act(() => target.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
		expect(element('[data-turn-rail]').dataset.expanded).toBe('true')
		expect(element('[aria-label="Conversation turn preview"]').textContent).toContain('Turn 5')
		expect(element('[aria-label="Conversation turn preview"]').textContent).toContain('Repeated prompt')
		expect(element<HTMLElement>('[data-entry-id="entry-5"] [data-turn-mark]').style.transform).toBe('scaleX(1)')
		expect(element<HTMLElement>('[data-entry-id="entry-4"] [data-turn-mark]').style.transform).toBe('scaleX(0.7083333333333334)')
		expect(element<HTMLElement>('[data-entry-id="entry-3"] [data-turn-mark]').style.transform).toBe('scaleX(0.4583333333333333)')
		expect(element<HTMLElement>('[data-entry-id="entry-2"] [data-turn-mark]').style.transform).toBe('scaleX(0.3125)')
		expect(document.activeElement).toBe(terminal)
		expect(navigate).not.toHaveBeenCalled()
		act(() => target.dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body })))
		expect(element('[data-turn-rail]').dataset.expanded).toBe('false')
		expect(document.querySelector('[aria-label="Conversation turn preview"]')).toBeNull()
	})

	it('scrolls the virtual marks with the wheel and consumes wheel input at both ends', () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': ready(1000) } })
		act(() => root.render(<TurnNavigation open={false} onOpenChange={close} blocked={false} />))
		const list = element<HTMLElement>('[data-turn-viewport]')
		Object.defineProperty(list, 'clientHeight', { value: 276 })
		const outerWheel = vi.fn()
		container.addEventListener('wheel', outerWheel)
		const scroll = (deltaY: number) => {
			const event = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
			act(() => list.dispatchEvent(event))
			expect(event.defaultPrevented).toBe(true)
		}
		scroll(600)
		expect(list.scrollTop).toBe(600)
		expect(document.querySelector('[data-entry-id="entry-1"]')).toBeNull()
		expect(document.querySelector('[data-entry-id="entry-51"]')).not.toBeNull()
		scroll(-100000)
		expect(list.scrollTop).toBe(0)
		scroll(-100)
		expect(list.scrollTop).toBe(0)
		scroll(100000)
		expect(list.scrollTop).toBe(11724)
		scroll(100)
		expect(list.scrollTop).toBe(11724)
		expect(outerWheel).not.toHaveBeenCalled()
		expect(navigate).not.toHaveBeenCalled()
	})

	it('hides the floating navigation in unsupported terminals unless explicitly opened', () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': { status: 'unavailable', snapshot: null, turns: [], error: null, navigating: false, shownPosition: null, pendingTarget: null } } })
		act(() => root.render(<TurnNavigation open={false} onOpenChange={close} blocked={false} />))
		expect(document.querySelector('[data-turn-rail]')).toBeNull()
		act(() => root.render(<TurnNavigation open onOpenChange={close} blocked={false} />))
		expect(element('[aria-label="Conversation turn preview"]').textContent).toContain('compatible OMP')
	})

	it('keeps the preview on the mark under the pointer when the list scrolls', () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': ready(100) } })
		act(() => root.render(<TurnNavigation open={false} onOpenChange={close} blocked={false} />))
		const list = element<HTMLElement>('[data-turn-viewport]')
		act(() => list.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY: 24 })))
		expect(element('[aria-selected="true"]').dataset.entryId).toBe('entry-3')
		act(() => { list.scrollTop = 120; list.dispatchEvent(new Event('scroll', { bubbles: true })) })
		expect(element('[aria-selected="true"]').dataset.entryId).toBe('entry-13')
	})

	it('supports choosing marks from the keyboard without opening a search field', () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': ready() } })
		act(() => root.render(<TurnNavigation open={false} onOpenChange={close} blocked={false} />))
		const list = element<HTMLElement>('[data-turn-viewport]')
		act(() => list.focus())
		expect(document.querySelector('[role="combobox"]')).toBeNull()
		act(() => list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })))
		expect(element('[aria-selected="true"]').dataset.entryId).toBe('entry-3')
		act(() => list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
		expect(navigate).toHaveBeenCalledWith('focused-terminal', { kind: 'turn', entryId: 'entry-3' })
	})

	it('restores visible marks after a modal temporarily hides a scrolled rail', () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': ready(1000) } })
		act(() => root.render(<TurnNavigation open={false} onOpenChange={close} blocked={false} />))
		const list = element<HTMLElement>('[data-turn-viewport]')
		act(() => { list.scrollTop = 6000; list.dispatchEvent(new Event('scroll', { bubbles: true })) })
		act(() => element('[data-entry-id="entry-501"]').dispatchEvent(new MouseEvent('pointerover', { bubbles: true })))
		act(() => root.render(<TurnNavigation open={false} onOpenChange={close} blocked />))
		expect(document.querySelector('[data-turn-rail]')).toBeNull()
		act(() => root.render(<TurnNavigation open={false} onOpenChange={close} blocked={false} />))
		expect(element<HTMLElement>('[data-turn-viewport]').scrollTop).toBe(0)
		expect(document.querySelector('[data-entry-id="entry-1"]')).not.toBeNull()
		expect(document.querySelector('[aria-label="Conversation turn preview"]')).toBeNull()
	})

	it('keeps the floating preview open when interacting with its portaled controls', () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': ready() } })
		act(() => root.render(<TurnNavigation open onOpenChange={close} blocked={false} />))
		const preview = element('[aria-label="Conversation turn preview"]')
		expect(container.contains(preview)).toBe(false)
		const input = element('[role="combobox"]')
		act(() => input.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
		expect(close).not.toHaveBeenCalled()
		const live = element<HTMLButtonElement>('[aria-label="Return to live terminal"]')
		act(() => live.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
		expect(close).not.toHaveBeenCalled()
		act(() => live.click())
		expect(returnLive).toHaveBeenCalledWith('focused-terminal')
		expect(close).toHaveBeenCalledWith(false)
	})
	it('targets the focused terminal and returns focus after selecting a unique entry', () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': ready() } })
		act(() => root.render(<><div data-pane-id="focused-pane"><textarea className="xterm-helper-textarea" /></div><TurnNavigation open onOpenChange={close} blocked={false} /></>))
		search('中文 修复')
		expect(document.querySelectorAll('[role="option"]')).toHaveLength(1)
		expect(element('[role="listbox"]').style.height).toBe('12px')
		expect(document.body.textContent).toContain('1 turn')
		expect(document.body.textContent).not.toContain('1 turns')
		act(() => element<HTMLElement>('[role="option"]').click())
		expect(navigate).toHaveBeenCalledWith('focused-terminal', { kind: 'turn', entryId: 'entry-2' })
		expect(document.activeElement).toBe(element('[data-pane-id="focused-pane"] textarea'))
	})

	it('virtualizes ten thousand turns and keeps real ordinals for repeated previews', () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': ready(10_000) } })
		act(() => root.render(<TurnNavigation open onOpenChange={close} blocked={false} />))
		expect(document.querySelectorAll('[role="option"]').length).toBeLessThan(40)
		const list = element('[role="listbox"]')
		act(() => { list.scrollTop = 12 * 9_995; list.dispatchEvent(new Event('scroll', { bubbles: true })) })
		const last = element('[data-entry-id="entry-10000"]')
		expect(last.getAttribute('aria-label')).toContain('10000')
		act(() => last.click())
		expect(navigate).toHaveBeenLastCalledWith('focused-terminal', { kind: 'turn', entryId: 'entry-10000' })
	})

	it('leaves IME confirmation and Escape inside the composing search unchanged', () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': ready() } })
		act(() => root.render(<TurnNavigation open onOpenChange={close} blocked={false} />))
		const input = element('[role="combobox"]')
		act(() => input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
		for (const key of ['ArrowDown', 'Enter', 'Escape']) act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
		expect(navigate).not.toHaveBeenCalled()
		expect(close).not.toHaveBeenCalled()
		act(() => input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
		search('中文')
		act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
		expect(element<HTMLInputElement>('[role="combobox"]').value).toBe('')
		expect(close).not.toHaveBeenCalled()
	})

	it('explains missing OMP capability and keeps unsupported navigation disabled', () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': { status: 'unavailable', snapshot: null, turns: [], error: null, navigating: false, shownPosition: null, pendingTarget: null } } })
		act(() => root.render(<TurnNavigation open onOpenChange={close} blocked={false} />))
		expect(document.body.textContent).toContain('compatible OMP')
		expect(document.querySelector('[role="option"]')).toBeNull()
		expect(document.querySelector('[aria-label="Return to live terminal"]')).toBeNull()
		expect(navigate).not.toHaveBeenCalled()
	})

	it('centers the turn rail on a pending target before the terminal frame is shown', () => {
		const state = ready(122)
		const snapshot = state.snapshot
		if (!snapshot) throw new Error('Missing fixture snapshot')
		const target: NavigationPosition = { ...snapshot.position, mode: 'browsing', entryId: 'entry-122', anchor: { partId: 'part', scalarOffset: 0 }, viewRevision: 2, frameId: 'target-frame' }
		snapshot.position = target
		snapshot.latestRequest = { requestId: 'request', status: { kind: 'applied', position: target, shown: false }, observationTimedOut: false }
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': state } })
		act(() => root.render(<TurnNavigation open={false} onOpenChange={close} blocked={false} />))
		const list = element<HTMLElement>('[data-turn-viewport]')
		expect(list.scrollTop).toBeGreaterThan(0)
		expect(document.querySelector('[data-entry-id="entry-122"]')).not.toBeNull()
	})

	it('anchors the rail on a selected turn before the native request settles', () => {
		const state = ready(122)
		state.pendingTarget = { kind: 'turn', entryId: 'entry-122' }
		state.navigating = true
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': state } })
		act(() => root.render(<TurnNavigation open={false} onOpenChange={close} blocked={false} />))
		const list = element<HTMLElement>('[data-turn-viewport]')
		expect(list.scrollTop).toBeGreaterThan(0)
		expect(document.querySelector('[data-entry-id="entry-122"]')).not.toBeNull()
	})

	it('does not highlight an applied target before its terminal frame is shown', () => {
		const state = ready()
		const snapshot = state.snapshot
		if (!snapshot) throw new Error('Missing fixture snapshot')
		const target: NavigationPosition = { ...snapshot.position, mode: 'browsing', entryId: 'entry-3', anchor: { partId: 'part', scalarOffset: 0 }, viewRevision: 2, frameId: 'next-frame' }
		snapshot.position = target
		snapshot.latestRequest = { requestId: 'request', status: { kind: 'applied', position: target, shown: false }, observationTimedOut: false }
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': state } })
		act(() => root.render(<TurnNavigation open onOpenChange={close} blocked={false} />))
		expect(element('[role="status"]').textContent).toBe('Waiting for terminal display…')
		expect(element('[aria-current="true"]').getAttribute('data-entry-id')).toBe('entry-2')
		act(() => {
			useOmpNavigationStore.setState({ byPane: { 'focused-terminal': { ...state, shownPosition: target, snapshot: { ...snapshot, latestRequest: { requestId: 'request', status: { kind: 'applied', position: target, shown: true }, observationTimedOut: false } } } } })
		})
		expect(element('[aria-current="true"]').getAttribute('data-entry-id')).toBe('entry-3')
		expect(element('[role="status"]').textContent).toBe('Turn 3 of 3')
	})

	it('retries a failed catalog connection in the focused terminal on explicit request', () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': { status: 'error', snapshot: null, turns: [], error: 'connection_failed', navigating: false, shownPosition: null, pendingTarget: null } } })
		act(() => root.render(<TurnNavigation open onOpenChange={close} blocked={false} />))
		const start = useOmpNavigationStore.getState().start
		expect(start).toHaveBeenCalledTimes(1)
		act(() => element<HTMLButtonElement>('[aria-label="Retry loading turns"]').click())
		expect(start).toHaveBeenCalledTimes(2)
		expect(start).toHaveBeenLastCalledWith('focused-terminal')
		expect(document.activeElement).toBe(element('[role="combobox"]'))
	})

	it('announces an IPC navigation failure while the catalog remains ready and allows another selection', () => {
		const state = ready()
		state.error = 'omp_navigation_request: stale_scope'
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': state } })
		act(() => root.render(<TurnNavigation open onOpenChange={close} blocked={false} />))
		expect(element('[role="alert"]').textContent).toBe('Could not change terminal position. Select the turn again to retry.')
		expect(document.body.textContent).not.toContain('stale_scope')
		expect(element('[aria-current="true"]').getAttribute('data-entry-id')).toBe('entry-2')
		act(() => element('[data-entry-id="entry-3"]').click())
		expect(navigate).toHaveBeenCalledWith('focused-terminal', { kind: 'turn', entryId: 'entry-3' })
	})

	it('sends shortcuts to the focused pane without selecting the sidebar session', async () => {
		useSessionStore.setState({ activeSessionId: 'sidebar-session' })
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': ready() } })
		act(() => root.render(<KeyboardHarness />))
		const terminal = element<HTMLTextAreaElement>('.xterm-helper-textarea')
		terminal.focus()
		await act(async () => terminal.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })))
		expect(relative).toHaveBeenCalledWith('focused-terminal', -1)
		expect(useSessionStore.getState().activeSessionId).toBe('sidebar-session')
		expect(document.activeElement).toBe(terminal)
		await act(async () => terminal.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })))
		expect(returnLive).toHaveBeenCalledWith('focused-terminal')
	})

	it('does not wait for an old frame after local terminal input advances the display', () => {
		const state = ready()
		const snapshot = state.snapshot
		if (!snapshot) throw new Error('Missing fixture snapshot')
		const oldPosition = snapshot.position
		const localPosition: NavigationPosition = { mode: 'live', sessionId: 'conversation', branchEpoch: 1, displayEpoch: 2, viewRevision: 2, frameId: 'local-frame' }
		snapshot.position = localPosition
		snapshot.latestRequest = { requestId: 'request', status: { kind: 'applied', position: oldPosition, shown: false }, observationTimedOut: true }
		state.shownPosition = localPosition
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': state } })
		act(() => root.render(<TurnNavigation open onOpenChange={close} blocked={false} />))
		expect(element('[role="status"]').textContent).toBe('Live terminal')
		expect(document.querySelector('[aria-current="true"]')).toBeNull()
	})

	it('leaves navigation shortcuts alone in editable fields, composition and modal dialogs', async () => {
		useOmpNavigationStore.setState({ byPane: { 'focused-terminal': ready() } })
		act(() => root.render(<KeyboardHarness />))
		const editable = element<HTMLInputElement>('[aria-label="Other editable field"]')
		editable.focus()
		const event = () => new KeyboardEvent('keydown', { key: 'PageUp', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
		await act(async () => editable.dispatchEvent(event()))
		const terminal = element<HTMLTextAreaElement>('.xterm-helper-textarea')
		terminal.focus()
		act(() => terminal.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })))
		await act(async () => terminal.dispatchEvent(event()))
		act(() => terminal.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
		const modal = document.createElement('div')
		modal.setAttribute('aria-modal', 'true')
		container.appendChild(modal)
		await act(async () => terminal.dispatchEvent(event()))
		expect(relative).not.toHaveBeenCalled()
	})
})
