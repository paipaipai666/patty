import type { ShortcutMap } from '../../shared/settingsTypes'
import { getFocusedSessionId } from '../store/workspaceStore'
import { useOmpNavigationStore } from '../store/ompNavigationStore'
import type { AppCommand, CommandFocus } from './applicationCommands'

export function createTurnNavigationCommands(shortcuts: Pick<ShortcutMap, 'turnDirectory' | 'previousTurn' | 'nextTurn' | 'returnToLive'>, toggleDirectory: () => CommandFocus): AppCommand[] {
	const disabledReason = () => {
		const sessionId = getFocusedSessionId()
		if (!sessionId) return 'Select a terminal first'
		const state = useOmpNavigationStore.getState().byPane[sessionId]
		if (state?.status === 'loading' || !state) return 'Connecting to OMP'
		if (state.status === 'unavailable') return 'This terminal needs a compatible OMP navigation adapter'
		if (state.status === 'error') return 'Conversation turns are unavailable'
		if (!state.snapshot?.scope) return 'Waiting for terminal navigation control'
		if (state.turns.length === 0) return 'No conversation turns yet'
		return undefined
	}
	const navigate = (direction: -1 | 1): CommandFocus => {
		const sessionId = getFocusedSessionId()
		if (sessionId) void useOmpNavigationStore.getState().relative(sessionId, direction)
		return 'focused-terminal'
	}
	return [
		{ id: 'turnDirectory', label: 'Toggle current conversation turns', group: 'Navigation', description: 'Current pane · Search prompts and jump in the terminal', keywords: '对话 目录 轮次 历史 提问', shortcut: shortcuts.turnDirectory, allowInEditable: true, disabledReason: () => getFocusedSessionId() ? undefined : 'Select a terminal first', run: toggleDirectory },
		{ id: 'previousTurn', label: 'Go to previous conversation turn', group: 'Navigation', description: 'Current pane · Previous prompt', keywords: '对话 上一轮 历史', shortcut: shortcuts.previousTurn, disabledReason, run: () => navigate(-1) },
		{ id: 'nextTurn', label: 'Go to next conversation turn', group: 'Navigation', description: 'Current pane · Next prompt', keywords: '对话 下一轮 历史', shortcut: shortcuts.nextTurn, disabledReason, run: () => navigate(1) },
		{ id: 'returnToLive', label: 'Return to live terminal', group: 'Navigation', description: 'Current pane · Leave conversation history', keywords: '对话 返回 实时 最新', shortcut: shortcuts.returnToLive, disabledReason, run: () => {
			const sessionId = getFocusedSessionId()
			if (sessionId) void useOmpNavigationStore.getState().returnLive(sessionId)
			return 'focused-terminal'
		} }
	]
}
